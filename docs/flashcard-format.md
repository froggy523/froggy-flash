## Froggy Flash – Flashcard JSON Format Specification

This document defines the JSON structure used by Froggy Flash. It is written to be **LLM-friendly**: deterministic, explicit, and easy to validate.

---

### 1. Top-level JSON structure

Each flashcard file is a single JSON object with these fields:

- **`name`** (string, required): Human-readable name of the flashcard set.
- **`description`** (string, recommended): Short description of the set’s contents or goal.
- **`cards`** (array of objects, required): Ordered list of flashcard items.

Example skeleton:

```json
{
  "name": "HTTP Basics",
  "description": "Fundamentals of the HyperText Transfer Protocol.",
  "cards": [
    {
      "...": "card objects (see below)"
    }
  ]
}
```

LLM guidance:

- Always generate a **single JSON object** at the root (no arrays or multiple objects).
- Do **not** include comments or trailing commas; the JSON must be valid.

---

### 2. Card object schema

Each element in `cards` is an object describing one multiple-choice question.

Required fields:

- **`question`** (string): The question text, as shown to the user. May contain **GitHub-flavored Markdown** (headings, lists, code fences, tables, math-free prose, etc.). The app renders it as formatted Markdown; escape literal characters as needed inside JSON strings (e.g. newlines as `\n`, backslashes doubled).
- **`choices`** (object): A map from choice keys (e.g. `"a"`, `"b"`, `"c"`) to choice objects.
- **`answer`** (string): The key of the correct choice (e.g. `"a"`). **Must exactly match** one key in `choices`.
- **`explanation`** (string): Explanation of why the correct answer is correct. Shown after the user answers.

Choice keys:

- Typically `"a"`, `"b"`, `"c"`, optionally `"d"`, `"e"`, etc.
- Keys are **case-sensitive**; use **lowercase letters** to be consistent.

Choice object fields:

- **`text`** (string, required): The visible text of the choice.
- **`explanation`** (string, optional): Why this choice is wrong (for incorrect options) or any extra commentary.

The app:

- Renders `question` as **Markdown** (sanitized HTML).
- Renders all entries in `choices`, sorted by key (`"a"`, `"b"`, `"c"`, ...).
- Treats `answer` as the only correct choice.
- Shows:
  - The card-level `explanation` as the main explanation for the correct answer.
  - The chosen choice’s `explanation` as an additional “why your choice was wrong” note when the user picks an incorrect option.

---

### 3. Full canonical example

```json
{
  "name": "Sample Networking Set",
  "description": "Introductory networking questions.",
  "cards": [
    {
      "question": "What does HTTP stand for?",
      "choices": {
        "a": {
          "text": "HyperText Transfer Protocol",
          "explanation": "This is the correct, standard expansion of HTTP."
        },
        "b": {
          "text": "High Text Transfer Protocol",
          "explanation": "“High Text” is not a standard term in networking."
        },
        "c": {
          "text": "Hyperlink Transfer Program",
          "explanation": "Sounds similar, but this is not the name of the protocol."
        }
      },
      "answer": "a",
      "explanation": "HTTP stands for HyperText Transfer Protocol. It is used for transferring hypertext documents on the web."
    },
    {
      "question": "Which port does HTTP typically use by default?",
      "choices": {
        "a": {
          "text": "21",
          "explanation": "Port 21 is typically used by FTP."
        },
        "b": {
          "text": "80",
          "explanation": "Correct: HTTP commonly uses port 80 by default."
        },
        "c": {
          "text": "443",
          "explanation": "Port 443 is typically used for HTTPS, the secure version of HTTP."
        }
      },
      "answer": "b",
      "explanation": "The conventional default port for HTTP is 80 (without TLS)."
    }
  ]
}
```

---

### 4. Invariants and constraints (for LLMs)

When **generating** or **editing** flashcard sets, adhere to these rules:

- **Single correct answer per card**
  - `answer` must be exactly one of the keys in `choices`.
  - Do not encode multiple correct answers in a single card.

- **Consistent choice keys**
  - Use simple, lowercase letter keys: `"a"`, `"b"`, `"c"`, etc.
  - Avoid numeric or complex keys (e.g. `"1"`, `"optionA"`).

- **Explanation usage**
  - Card-level `explanation` should explain **why the correct answer is correct**, often with extra context.
  - Choice-level `explanation` should explain **why that choice is wrong** (for incorrect options) or add nuance (for the correct option).

- **Content clarity**
  - Make `question` (including any Markdown) and `choices[*].text` self-contained; avoid referring to external context that won’t be visible to the user.
  - Avoid ambiguous wording where multiple choices could plausibly be correct.
  - For Markdown in `question`, prefer fenced code blocks for snippets and keep heading levels modest so the card stays readable.

- **JSON-only output for programmatic use**
  - If the LLM is asked to “output a flashcard set”, respond only with the JSON object matching this schema (no prose around it), unless explicitly instructed otherwise.

---

### 5. Summary (for quick LLM recall)

- A flashcard file is **one JSON object** with `name`, `description`, and a `cards` array.
- Each card has `question` (plain text or **Markdown**), `choices`, `answer`, `explanation`.
- `choices` is a map from letter keys (`"a"`, `"b"`, `"c"`, …) to `{ "text": string, "explanation"?: string }`.
- `answer` is the **letter key** of the correct choice and **must exist** in `choices`.
- Explanations are used both:
  - At the card level (why correct), and
  - At the choice level (why an incorrect choice is wrong).


