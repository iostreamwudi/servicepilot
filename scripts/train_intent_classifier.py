import hashlib
import json
import re
import sys
import os
from collections import Counter
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report

if len(sys.argv) < 3:
    raise SystemExit("Usage: python train_intent_classifier.py <csds-dir> <output.json>")

source_dir, output_path = Path(sys.argv[1]), Path(sys.argv[2])

def clean(value):
    value = re.sub(r"\s+", "", str(value or ""))
    value = re.sub(r"\[\s*USERID[^\]]*\]", "[账号]", value, flags=re.I)
    value = re.sub(r"1[3-9]\d{9}", "[电话]", value)
    value = re.sub(r"\d{17}[\dXx]", "[身份证号]", value)
    value = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[邮箱]", value)
    return value.replace("京东", "平台").lower()

def classify(intent, summary):
    intent, summary = str(intent or ""), str(summary or "")
    signal = f"{intent}{summary}"
    if re.search(r"发票|增票", signal): return "invoice"
    if re.search(r"地址|收货信息|联系电话|手机号码|手机号", summary) and re.search(r"修改|更改|改|填错|确认", summary): return "address"
    if re.search(r"物流损", intent) or re.search(r"破损|损坏|质量问题|融化|坏了|少商品|少配件", summary): return "damage"
    if re.search(r"退款|返款|到账", signal): return "refund"
    return "unsupported"

def load_split(name):
    texts, labels, metadata = [], [], []
    dialogues = json.loads((source_dir / f"{name}.json").read_text())
    for dialogue in dialogues:
        turns = {item["turn"]: item for item in dialogue["Dialogue"]}
        for index, qa in enumerate(dialogue["QA"]):
            ids = qa.get("QueSummUttIDs", [])
            utterances = [turns[item]["utterance"] for item in ids if item in turns and turns[item].get("speaker") == "Q"]
            query = clean("；".join(utterances) if utterances else qa.get("QueSumm", ""))
            finite_ids = [item for item in ids if isinstance(item, (int, float))]
            first_turn = min(finite_ids) if finite_ids else None
            history = [] if first_turn is None else [item for item in dialogue["Dialogue"] if item["turn"] < first_turn][-4:]
            history_text = "；".join(f"{'用户' if item.get('speaker') == 'Q' else '客服'}:{clean(item.get('utterance'))}" for item in history)
            texts.append(f"当前:{query}；上下文:{'' if os.getenv('QUERY_ONLY') else history_text}")
            labels.append(classify(qa.get("intent", ""), qa.get("QueSumm", "")))
            metadata.append((dialogue["DialogueID"], index, query))
    return texts, labels, metadata

train_x, train_y, _ = load_split("train")
val_x, val_y, _ = load_split("val")
test_x, test_y, _ = load_split("test")

vectorizer = TfidfVectorizer(analyzer="char", ngram_range=(2, 4), min_df=3, max_features=10000, sublinear_tf=True, norm="l2")
train_matrix = vectorizer.fit_transform(train_x)
classifier = LogisticRegression(C=3.0, max_iter=350, class_weight="balanced", solver="lbfgs")
classifier.fit(train_matrix, train_y)

for name, texts, labels in [("val", val_x, val_y), ("test", test_x, test_y)]:
    predicted = classifier.predict(vectorizer.transform(texts))
    print(name, classification_report(labels, predicted, digits=4, zero_division=0))

focused = []
for split in ("train", "val", "test"):
    path = Path(f"data/eval-csds-full-{split}.json")
    if path.exists(): focused.extend(json.loads(path.read_text())["cases"])
focused_context = [item for item in focused if item.get("contextRequired")]
focused_text = [f"当前:{clean(item['query'])}；上下文:" + ("" if os.getenv("QUERY_ONLY") else "；".join(f"{'用户' if turn['role'] == 'user' else '客服'}:{clean(turn['content'])}" for turn in item.get("history", [])[-4:])) for item in focused_context]
focused_labels = [item["category"].replace("real-", "") for item in focused_context]
focused_predicted = classifier.predict(vectorizer.transform(focused_text))
print("focused-context", classification_report(focused_labels, focused_predicted, digits=4, zero_division=0))
classes = classifier.classes_.tolist()
unsupported_index = classes.index("unsupported")
focused_probabilities = classifier.predict_proba(vectorizer.transform(focused_text))
test_probabilities = classifier.predict_proba(vectorizer.transform(test_x))
for threshold in (0.40, 0.50, 0.60, 0.70, 0.80):
    def gated(probabilities):
        result = []
        for row in probabilities:
            supported = [(row[index], label) for index, label in enumerate(classes) if label != "unsupported"]
            probability, label = max(supported)
            result.append(label if probability >= threshold and probability > row[unsupported_index] else "unsupported")
        return result
    focused_gate = gated(focused_probabilities)
    context_accuracy = sum(a == b for a, b in zip(focused_labels, focused_gate)) / len(focused_labels)
    test_gate = gated(test_probabilities)
    unsupported_rows = [index for index, label in enumerate(test_y) if label == "unsupported"]
    safe_rate = sum(test_gate[index] == "unsupported" for index in unsupported_rows) / len(unsupported_rows)
    print("gate", threshold, "focused_context_accuracy", round(context_accuracy, 4), "test_unsupported_safe", round(safe_rate, 4))

features = vectorizer.get_feature_names_out().tolist()
model = {
    "version": "csds-char-tfidf-logreg-v1",
    "trainingSplit": "train",
    "featurePolicy": "Chinese character 2-4 gram TF-IDF over current query" if os.getenv("QUERY_ONLY") else "Chinese character 2-4 gram TF-IDF over current query and bounded four-turn context",
    "usesHistory": not bool(os.getenv("QUERY_ONLY")),
    "privacy": "Model contains only aggregate feature weights and no source utterances.",
    "sourceFingerprint": hashlib.sha256(json.dumps([item[:24] for item in train_x], ensure_ascii=False).encode()).hexdigest(),
    "classes": classifier.classes_.tolist(),
    "vocabulary": {feature: index for index, feature in enumerate(features)},
    "idf": np.round(vectorizer.idf_, 6).tolist(),
    "coefficients": np.round(classifier.coef_, 6).tolist(),
    "intercepts": np.round(classifier.intercept_, 6).tolist(),
    "trainingCounts": Counter(train_y),
}
output_path.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")) + "\n")
print(json.dumps({"output": str(output_path), "features": len(features), "classes": model["classes"], "trainingCounts": model["trainingCounts"]}, ensure_ascii=False, indent=2))
