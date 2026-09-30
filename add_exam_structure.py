# -*- coding: utf-8 -*-
"""向 seed.json 注入：IAL P1/P2 真题卷元数据 + 按卷知识树 + 现有 A-Level 数学题挂接题号/Topic"""
import json

with open("backend/seed.json", encoding="utf-8") as f:
    seed = json.load(f)

# 1) 真题卷元数据（四套，全部 published）
seed["examPapers"] = [
    {"paperName": "P1", "paperCode": "WMA11/01", "year": 2024, "session": "June", "status": "published",
     "examBoard": "Edexcel", "qualification": "IAL", "subject": "Mathematics"},
    {"paperName": "P1", "paperCode": "WMA11/01", "year": 2024, "session": "January", "status": "published",
     "examBoard": "Edexcel", "qualification": "IAL", "subject": "Mathematics"},
    {"paperName": "P2", "paperCode": "WMA12/01", "year": 2024, "session": "June", "status": "published",
     "examBoard": "Edexcel", "qualification": "IAL", "subject": "Mathematics"},
    {"paperName": "P2", "paperCode": "WMA12/01", "year": 2024, "session": "January", "status": "published",
     "examBoard": "Edexcel", "qualification": "IAL", "subject": "Mathematics"},
]

# 2) 按卷知识树（paperScope + sortOrder；题量挂接靠 topic 名称）
KN = []
def kn(paper, name, order, parent=None):
    KN.append({"subject": "A-Level 数学", "name": name, "parent": parent or "", "paperScope": paper, "sortOrder": order})

# P1（Edexcel IAL Pure 1 章节顺序）
kn("P1", "Algebraic Expressions & Quadratics", 1)
kn("P1", "Equations & Inequalities", 2)
kn("P1", "Graphs & Transformations", 3)
kn("P1", "Straight Lines & Circles", 4)
kn("P1", "Trigonometry", 5)
kn("P1", "Differentiation", 6)
kn("P1", "Differentiation", 6)  # 占位去重
KN = [k for i, k in enumerate(KN) if not (i > 0 and k["name"] == KN[i-1]["name"] and k["paperScope"] == KN[i-1]["paperScope"])]
kn("P1", "Integration", 7)
# P2
kn("P2", "Proof", 1)
kn("P2", "Binomial Expansion", 2)
kn("P2", "Trigonometric Identities", 3)
kn("P2", "Exponentials & Logarithms", 4)
kn("P2", "Differentiation", 5)
kn("P2", "Integration", 6)

# 子级（少量示例，供 Subtopic 浏览演示）
SUBS = [
    ("P1", "Differentiation", "Stationary Points"),
    ("P1", "Differentiation", " Tangents & Normals"),
    ("P1", "Integration", "Definite Integrals"),
    ("P2", "Exponentials & Logarithms", "Solving Equations"),
    ("P2", "Binomial Expansion", "Coefficient Finding"),
]
for paper, parent, name in SUBS:
    KN.append({"subject": "A-Level 数学", "name": name.strip(), "parent": parent, "paperScope": paper, "sortOrder": 9})

seed["knowledgePaper"] = KN

# 3) 现有 A-Level 数学题挂接真题卷 + 题号 + Topic
#    key: 题干前缀 → (卷序号 1-4, 题号, 子题, Topic, Subtopic)
MAPPING = [
    ("The circle with equation", 1, "1", "", "Straight Lines & Circles", ""),
    ("Given y = 3x", 1, "2", "", "Differentiation", ""),
    ("A particle P moves along a straight line", 1, "3", "a", "Differentiation", "Stationary Points"),
    ("For 0° ≤ x ≤ 360", 2, "4", "", "Trigonometry", ""),
    ("Evaluate the definite integral", 2, "5", "", "Integration", "Definite Integrals"),
    ("In the expansion of (1 + 2x)", 3, "1", "", "Binomial Expansion", "Coefficient Finding"),
    ("Solve 2ˣ = 40", 3, "2", "", "Exponentials & Logarithms", "Solving Equations"),
    ("Find the coefficient of x² in the expansion", 3, "3", "", "Binomial Expansion", ""),
    ("The curve C has equation y = x³ − 6x² + 9x", 4, "4", "", "Differentiation", "Stationary Points"),
    ("A particle P moves along a straight line. At time t seconds its velocity is v = 6t", 1, "3", "b", "Differentiation", ""),
]
count = 0
for q in seed["questions"]:
    if q["subject"] != "A-Level 数学":
        continue
    for prefix, ep_idx, number, sub, topic, subtopic in MAPPING:
        if q["stem"].startswith(prefix):
            q["examPaperIndex"] = ep_idx
            q["questionNumber"] = number
            q["subQuestion"] = sub
            q["questionOrder"] = int(number)
            q["topicName"] = topic
            q["subTopicName"] = subtopic.strip()
            count += 1
            break
print("questions mapped to exam papers:", count)

with open("backend/seed.json", "w", encoding="utf-8") as f:
    json.dump(seed, f, ensure_ascii=False, indent=1)
print("seed updated: examPapers", len(seed["examPapers"]), "| knowledgePaper", len(KN))
