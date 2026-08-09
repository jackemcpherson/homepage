# Markdown Style Guide

Rules for clear, consistent, and maintainable Markdown documentation.
This guide covers source format and technical prose.

The language rules use ASD-STE100 Issue 9 as their basis.
This guide does not claim ASD-STE100 compliance.

---

## Scope

Apply this guide to all human-authored and AI-authored Markdown files.
This scope includes documentation, guides, and conventional repository files.

Exclude these files:

- Generated files that identify their generator.
- Vendored files that the project does not maintain.
- Archived files that remain only as historical records.

Make generated templates conform where practical.
Do not edit generated output to fix style faults.

Project rules take precedence when a project requires different syntax.
Record each project exception near the applicable configuration.

## Principles

Use these principles in this order:

1. Preserve technical accuracy.
2. Make the text clear to its intended reader.
3. Keep the source portable and maintainable.
4. Use consistent syntax and terminology.
5. Remove text that does not help the reader.

Keep documentation small, current, and useful.
Update documentation in the same change as the related code.
Delete obsolete content instead of adding corrections around it.

## Tooling

Use two tools with separate responsibilities.

| Tool    | Responsibility                  | Reason                                                |
| ------- | ------------------------------- | ----------------------------------------------------- |
| `rumdl` | Markdown linting and formatting | It is fast, opinionated, and available as one binary. |
| Vale    | Prose and terminology linting   | It understands Markdown and supports local rules.     |

Do not add another formatter, Markdown linter, spelling tool, or prose linter.
Add a tool only when neither selected tool can enforce a required rule.

### Install the Tools

Install `rumdl` with `uv`:

```shell
uv tool install rumdl
```

Run it without installation when you need a temporary copy:

```shell
uvx rumdl check --deny-config-warnings .
```

Install Vale as a native binary.
On macOS, use Homebrew:

```shell
brew install vale
```

Pin exact tool releases in continuous integration.
Update each pin in a reviewed change.

### Run the Checks

Use these commands:

```shell
rumdl check --deny-config-warnings .
vale --no-global .
```

Use `rumdl` to apply safe formatting fixes:

```shell
rumdl check --deny-config-warnings --fix .
```

Review every automatic change before you commit it.
Vale does not replace an editor or technical review.

### Configure `rumdl`

Start with the Google preset:

```shell
rumdl init --preset google
```

Apply these project settings in `.rumdl.toml`:

```toml
[global]
flavor = "gfm"
line-length = 80
extend-enable = ["MD060", "MD063", "MD080", "MD082"]
exclude = ["vendor/**", "generated/**", "archive/**"]

[MD003]
style = "atx"

[MD004]
style = "dash"

[MD013]
line-length = 80
code_blocks = false
headings = false
tables = false

[MD033]
allowed_elements = []

[MD035]
style = "---"

[MD063]
style = "title-case"
```

Keep all findings enabled unless this guide permits an exception.
Run `rumdl` with its default `--fail-on any` setting.

### Configure Vale

Store Vale rules in the repository.
Do not depend on a global user configuration.

Use this base `.vale.ini` file:

```ini
StylesPath = styles
MinAlertLevel = error
Vocab = Project

[*.md]
BasedOnStyles = Vale, House
Vale.Spelling = NO
```

Put custom rules in `styles/House/`.
Put accepted and rejected terms in `styles/config/vocabularies/Project/`.
Put `en_AU.aff` and `en_AU.dic` in `styles/config/dictionaries/`.

Configure each enabled House rule with `level: error`.
Use House rules for these checks:

- Australian English spelling.
- Project technical terms.
- Descriptive sentence length.
- Paragraph length.
- Passive voice.
- Contractions and Latin abbreviations.
- Vague attribution and unclear references.
- Prohibited punctuation.
- Negative parallel constructions.
- Bold labels at the start of list items.
- Prohibited phrases and writing patterns.

Create `styles/House/Spelling.yml` for Australian English:

```yaml
extends: spelling
message: "Check the Australian English spelling of '%s'."
level: error
dictionaries:
  - en_AU
```

For example, create `styles/House/AIWriting.yml`:

```yaml
extends: existence
message: "Replace '%s' with direct technical prose."
level: error
ignorecase: true
tokens:
  - delve
  - harness
  - it is worth noting
  - serves as
  - tapestry
```

Create `styles/House/SentenceLength.yml` for descriptive sentences:

```yaml
extends: occurrence
message: "Use no more than 25 words in a descriptive sentence."
level: error
scope: sentence
max: 25
token: '\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?\b'
```

Vale cannot identify every procedure or validate technical meaning.
Review procedural sentence length, approved words, and word meaning manually.

### Handle Exceptions

All configured findings fail the check.
Fix the text when a rule reports a valid fault.

Use a narrow inline suppression only in these cases:

- An exact quotation contains the reported text.
- Required technical syntax causes the report.
- A rule produces a documented false positive.

Add a comment that gives the reason for each suppression.
Do not disable a rule for a complete file without review.

## Document Structure

Start each document with one H1 heading.
Make the title match the filename as closely as practical.

Add a short introduction after the title.
State the purpose, audience, and necessary context in one to three sentences.

Put a horizontal rule after the introduction in a long guide.
Start the main content with H2 headings.

Use this basic structure:

```markdown
# Document Title

State the purpose and audience.

---

## First Topic

Write the content.

## References

- [Descriptive source title](https://example.com/source)
```

Do not add these items unless a publishing tool requires them:

- YAML front matter.
- An author line.
- A revision date.
- A manual revision history.

Version control contains authorship and revision history.

### Use a Table of Contents Only When Necessary

Do not add a table of contents to a short document.
Add one when readers need it to find a topic in a long document.

Write the table of contents as a standard Markdown list.
Do not use renderer-specific directives such as `[TOC]`.

### End with References When Sources Inform the Text

Add a `References` section when external sources inform the document.
Name each source and link to the exact page.

Put a citation near a claim when the source is important to that claim.
Do not use vague attributions such as `experts say` or `research shows`.

## Files and Characters

Use lowercase kebab-case filenames with the `.md` extension:

```text
deployment-guide.md
api-authentication.md
```

Keep conventional filenames uppercase:

```text
README.md
CHANGELOG.md
CONTRIBUTING.md
```

Use UTF-8 encoding and Unix line endings.
End each file with one newline.
Do not use tabs or trailing whitespace.

Use ASCII punctuation in authored prose.
Do not use em dashes, en dashes, curly quotation marks, or decorative arrows.

Use a Unicode character only when accuracy requires it.
Valid cases include a proper name, unit, formula, or exact quotation.

## Line Length

Wrap prose at 80 characters.
Wrap text at natural phrase boundaries.
Do not split an inline code span across lines.

These elements can exceed 80 characters:

- Headings.
- Tables.
- Link destinations.
- Code blocks.
- Output that must remain exact.

Do not put two spaces at a line end to create a hard break.
Use a new paragraph or a trailing backslash when a hard break is necessary.

## Headings

Use ATX headings with a space after the hash marks:

```markdown
# Document Title

## Main Topic

### Detailed Topic
```

Use one H1 heading in each document.
Do not skip a heading level.
Do not use emphasis as a substitute for a heading.

Use Title Case for all headings.
Keep product names and code identifiers unchanged.

Make every heading complete, descriptive, and unique in its document.
Unique headings produce stable and clear link anchors.

Do not put punctuation at the end of a heading.
Use punctuation only when it is part of a code identifier.

## Paragraphs

Put one topic in each paragraph.
State the topic in the first sentence.
Put supporting information after that sentence.

Keep paragraphs short enough to scan.
Split a paragraph when its topic changes.

Do not add an introduction and conclusion to every section.
Do not repeat a point in different words.
Remove a paragraph when it adds no new information.

## Controlled Language

Use the approved general words in the ASD-STE100 Issue 9 dictionary.
Use each approved word only with its approved meaning and part of speech.

Use established project terms as technical nouns or technical verbs.
Define an unfamiliar technical term at its first use.

Use one term for one concept.
Do not change terms only to add variety.
Keep a project term list in the Vale vocabulary.

Use Australian English spelling.
This spelling rule is an intentional difference from ASD-STE100.

### Keep Sentences Short

Use no more than 20 words in a procedural sentence.
Use no more than 25 words in a descriptive sentence.

Put one instruction or one topic in each sentence.
Do not omit a subject, verb, or necessary article to reduce length.

Exclude these elements from automated word counts:

- Headings.
- Tables.
- Code and command blocks.
- URLs.
- Exact quotations.

Manual review must confirm that each exclusion remains clear.

### Use Active Voice

Use active voice and identify the actor.
Use `you` for the reader in instructions.

Write:

```text
Run the migration before you deploy the service.
```

Do not write:

```text
The migration must be run before the service is deployed.
```

Use passive voice only when the actor is unknown or has no importance.
Do not use passive voice to hide responsibility.

### Use Direct Verbs

Use a verb to describe an action.
Do not replace the verb with an abstract noun.

Write:

```text
Compare the two files.
```

Do not write:

```text
Perform a comparison of the two files.
```

Do not make a phrasal verb when a direct verb gives the same meaning.
Check the approved dictionary before you replace a word.

### Use Clear Instructions

Use imperative mood for procedures.
Use present tense for descriptions.
Use future tense only for an event that occurs later.

Put a condition before its action when the sequence is important:

```text
If the check fails, stop the deployment.
```

Write steps in the order that the reader completes them.
Give one action in each numbered step.

### Use Explicit References

Make every pronoun refer to one clear noun.
Repeat the noun when `it`, `this`, or `that` can have two meanings.

Do not use `this` alone as a noun.
Write a noun after it, such as `this command` or `this result`.

### Do Not Use Contractions or Informal Language

Do not use contractions.
Write `do not`, `cannot`, and `it is`.

Do not use idioms, slang, profanity, jokes, or culture-specific references.
Do not assume that the reader shares the writer's first language.

Use inclusive and gender-neutral language.
Do not describe people by an unrelated personal characteristic.

### Control Abbreviations

Define an abbreviation at its first use unless all intended readers know it.
Do not invent an abbreviation only to make text shorter.

Do not use Latin abbreviations.
Write `for example` instead of `e.g.`.
Write `that is` instead of `i.e.`.
Write the complete list instead of `etc.`.

### Keep Punctuation Simple

Use a full stop for a statement or instruction.
Use a colon before a list or an explanation.
Do not use semicolons.

Use parentheses only for short identifiers, units, abbreviations, or necessary
cross-references.
Write other asides as separate sentences.

## Prohibited Writing Patterns

Do not use the patterns in this section in authored prose.
This prohibition applies even when a pattern occurs only one time.

Exceptions apply only to exact quotations, code, proper names, and bad examples.

### Prohibited Word Choices

Do not use an ornate word when a common word gives the same meaning.
Do not add an adverb only to make an ordinary fact sound important.

Prohibit these forms:

- Stock AI verbs such as `delve`, `leverage`, `harness`, and `streamline`.
- Inflated adjectives such as `robust`, `remarkable`, and `fundamental`.
- Grand nouns such as `tapestry`, `landscape`, `paradigm`, and `synergy`.
- Indirect forms such as `serves as` when `is` gives the same meaning.
- Empty signals such as `notably`, `interestingly`, and `it is worth noting`.

Keep the project's prohibited term list in Vale.
Review context before you replace a prohibited word.

### Prohibited Sentence Patterns

Do not use a negative comparison to manufacture contrast.
State the correct point directly.

Do not use these patterns:

- A repeated `not X, but Y` construction.
- A sequence that rejects options before it gives the answer.
- A rhetorical question followed by its answer.
- Repeated sentence openings for dramatic effect.
- Repeated groups of three parallel words or clauses.
- A final `-ing` phrase that adds no information.
- A `from X to Y` range without a real scale.

Do not use sentence fragments for emphasis.
Use complete sentences unless a user interface label requires a fragment.

### Prohibited Tone

Do not manufacture suspense before an ordinary fact.
Do not invite the reader to imagine a future scenario.
Do not use an analogy when the technical explanation is clearer.

Do not claim personal honesty, vulnerability, or privileged insight.
Do not say that a claim is simple, obvious, or indisputable.
Provide the evidence instead.

Do not inflate the importance of a change.
Describe its measured effect and scope.

Do not use teaching transitions such as `let us unpack this`.
Start with the information that the reader needs.

Do not invent a dramatic label for an ordinary problem.
Use an established technical term or describe the problem.

### Prohibited Formatting

Do not use em dashes or double hyphens as sentence pivots.
Do not replace them with decorative Unicode characters.

Do not start each list item with a bold label.
Use a table or descriptive heading when items need named fields.

Do not add emoji, icons, smart quotes, or decorative arrows.
Use exact symbols only when technical accuracy requires them.

### Prohibited Composition

Do not announce, repeat, and then summarise the same content.
State each fact one time in the best location.

Do not repeat one metaphor through a document.
Do not stack historical comparisons to imply authority.

Do not expand one point into many sections.
Do not duplicate sections, paragraphs, or sentences.

Do not announce a conclusion with a stock phrase.
End after the final necessary point.

Do not dismiss known problems with a formulaic optimistic ending.
State each limitation and its effect directly.

## Lists

Use `-` for an unordered list.
Use a list only when each item has the same relationship to its introduction.

Use explicit sequential numbers for a short ordered list:

```markdown
1. Stop the service.
2. Apply the migration.
3. Start the service.
```

Use `1.` for all items when frequent reordering makes maintenance safer:

```markdown
1. Stop the service.
1. Apply the migration.
1. Start the service.
```

Indent nested content by four spaces.
Keep list items parallel in grammar and purpose.

Write complete sentences in list items.
Use fragments only for short labels, names, or tabular values.

Do not hide a list inside paragraphs named first, second, and third.
Use a real list when information is a sequence or set.

## Code

Use backticks for these inline elements:

- Commands.
- Filenames and paths.
- Code identifiers.
- Configuration keys.
- Literal values.
- Text that Markdown must not interpret.

Use fenced code blocks for multiline content.
Add an accurate language tag to every fence.

Use `text` when no more specific language applies:

````markdown
```text
Exact output goes here.
```
````

Do not use indented code blocks.
Their boundaries and language are not clear.

Omit a shell prompt from commands that readers can copy:

```shell
rumdl check --deny-config-warnings .
vale --no-global .
```

Use a trailing backslash only when a shell command must continue:

```shell
tool run --first-option value \
  --second-option value
```

Keep examples small, valid, and consistent with the applicable code guide.
Show only the output that helps the reader verify the command.

## Comparison Examples

Explain a rule before its example.
Use `Write:` and `Do not write:` as labels.

Write:

```markdown
Use the cache only after authentication succeeds.
```

Do not write:

```markdown
Importantly, the cache serves as a robust authentication optimisation.
```

Do not use emoji or icons to mark correct and incorrect examples.
Do not use decorative `Good` and `Bad` labels.

## Links

Write descriptive link text that identifies the destination.
Do not use `here`, `link`, or a bare URL as link text.

Write:

```markdown
Read the [Markdown style guide](markdown-style-guide.md).
```

Do not write:

```markdown
Read it [here](markdown-style-guide.md).
```

Use an inline link when its destination keeps the source readable.
Use a reference link for a long or repeated destination.

Define a reference link after its first section of use.
Put shared reference definitions at the end of the document.

Use a relative path only for a file in the same directory.
Use a root-relative path for a file in another project directory.

Check internal destinations and heading anchors.
Do not link to a search result when an exact page exists.

## Images

Use an image only when it explains information faster than text.
Do not use an image as decoration.

Write useful alt text that communicates the image's purpose.
Use empty alt text only when an image is decorative and required.

Store local documentation images in an adjacent `img/` directory.
Use lowercase kebab-case image filenames.

Use this syntax:

```markdown
![Request path through the authentication service](img/authentication-flow.svg)
```

Do not put essential instructions only in an image.
Keep labels legible at the image's rendered size.

## Tables

Use a table for compact data with parallel rows and consistent columns.
Use a list or sections when cells need paragraphs.

Keep cells short.
Do not add manual line breaks or raw HTML inside a cell.

Use a header row and delimiter row:

```markdown
| Tool | Purpose |
| --- | --- |
| `rumdl` | Check Markdown syntax. |
| Vale | Check prose. |
```

Table lines can exceed 80 characters.
Use reference links when inline destinations make a table hard to read.

## Emphasis

Use headings and sentence structure instead of decorative emphasis.
Do not use emphasis as a substitute for document structure.

Use bold only for text that readers must find quickly.
A safety label is a valid use.

Do not start every list item with bold text.
Use italics only for a title or a term at its first use.

## Notes and Warnings

Use a descriptive heading for a note or warning:

```markdown
### Warning: Data Loss

This command permanently deletes the database.
```

Name the specific risk in the heading.
Put the required prevention before the hazardous action.

Do not use generic headings such as `Note` or `Warning`.
Do not use GitHub alert syntax, emoji, or blockquote decoration.

## Raw HTML and Extensions

Use CommonMark as the baseline syntax.
Permit GitHub Flavored Markdown tables and task lists.

Do not use raw HTML when Markdown can express the content.
Do not use renderer-specific directives or custom containers.

Use a syntax extension only when the publishing system requires it.
Record the extension and its reason in the project documentation.

## Review Checklist

Before you approve a Markdown change, confirm these facts:

- The document is necessary, accurate, and current.
- The title and all headings use Title Case.
- The document has one H1 and does not skip heading levels.
- Prose lines contain no more than 80 characters.
- Paragraphs contain no more than six sentences.
- Procedural sentences contain no more than 20 words.
- Descriptive sentences contain no more than 25 words.
- General words follow the approved controlled vocabulary.
- Project terms have consistent definitions.
- Instructions use active voice and imperative mood.
- Prose does not contain semicolons or decorative Unicode punctuation.
- Lists do not start items with bold labels.
- Notes and warnings do not use blockquotes.
- The prose contains no prohibited writing pattern.
- Links identify their destinations and resolve correctly.
- Images have useful alt text.
- Code fences have accurate language tags.
- `rumdl check --deny-config-warnings .` succeeds.
- `vale --no-global .` succeeds.

## Design Principles

Apply these principles when two rules appear to conflict.

### 1. Accuracy Comes First

Do not simplify text until its technical meaning changes.
Ask a subject expert when the meaning is not clear.

### 2. Source Text Is a User Interface

Readers use rendered output and raw Markdown.
Keep both forms clear, portable, and suitable for review.

### 3. One Concept Has One Term

Consistent terms reduce ambiguity and translation cost.
Do not use synonyms only to make the prose seem varied.

### 4. Structure Carries Meaning

Use headings, lists, code blocks, and tables for their defined purposes.
Do not use decoration to create false structure.

### 5. Short Documentation Stays Current

Keep only information that helps the intended reader complete a task.
Delete stale and duplicate content promptly.

### 6. Tools Enforce Mechanics

Use tools for repeatable checks.
Use human review for accuracy, context, tone, and exceptions.

## References

- [Google Markdown style guide](https://google.github.io/styleguide/docguide/style.html)
- [tropes.md AI writing patterns](https://tropes.fyi/tropes-md)
- [ASD-STE100 Simplified Technical English, Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf)
- [CommonMark specification](https://spec.commonmark.org/)
- [GitHub Flavored Markdown specification](https://github.github.com/gfm/)
- [`rumdl` documentation](https://rumdl.dev/)
- [Vale documentation](https://vale.sh/docs/)
