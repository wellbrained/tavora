"""Apply explicitly captured, rendered public guide sections to a portable build.

No network, model, script execution or inference. Each variant must match the
snapshot's selected tabs. This utility does not fetch unrendered web pages.
"""
from html.parser import HTMLParser
import argparse
import copy
import json
import re


class RichText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'):
            self.skip += 1
        if self.skip:
            return
        if tag == 'br':
            self.parts.append('\n')
        if tag in ('p', 'li', 'blockquote') or re.fullmatch(r'h[1-6]', tag):
            self.parts.append('\n\n')
        if tag == 'img' and dict(attrs).get('alt'):
            self.parts.append(dict(attrs)['alt'])

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript'):
            self.skip = max(0, self.skip - 1)
            return
        if not self.skip and (tag in ('p', 'li', 'blockquote') or re.fullmatch(r'h[1-6]', tag)):
            self.parts.append('\n\n')

    def handle_data(self, text):
        if not self.skip:
            self.parts.append(text)

    def text(self):
        lines = [' '.join(line.split()) for line in ''.join(self.parts).splitlines()]
        return re.sub(r'\n{3,}', '\n\n', '\n'.join(lines)).strip()


def rendered_text(markup):
    parser = RichText()
    parser.feed(markup)
    parser.close()
    return parser.text()


def repair_build(document, snapshots):
    result = copy.deepcopy(document)
    if result.get('format') != 'tavora.build' or result.get('formatVersion') != 1:
        raise ValueError('Expected a portable Tavora v1 build')
    build = result['build']
    labels = [stage.get('label') or stage.get('name') for stage in build['stages']]
    by_label = {entry['label']: entry for entry in snapshots}
    if len(by_label) != len(snapshots) or set(labels) != set(by_label):
        raise ValueError('Snapshots must match every build variant exactly')
    guide = copy.deepcopy(result.get('guideText') or build.get('guideText') or {})
    sections, stage_notes, descriptions, seen = [], {}, {}, set()
    contexts = {'Equipment': 'gear', 'Skill Gems': 'skills', 'Passive Tree': 'tree'}
    for index, label in enumerate(labels):
        notes = {}
        for entry in by_label[label]['sections']:
            title = entry['title']
            if title in (*contexts, 'Build Variants') and entry.get('selected') != [label]:
                raise ValueError(f'Wrong selected variant for {title}: {label}')
            text = '\n\n'.join(filter(None, (rendered_text(h) for h in entry.get('editors', []))))
            if not text:
                continue
            context = contexts.get(title, 'gear' if title == 'How it Works' else 'overview')
            if title == 'Build Variants':
                descriptions[str(index)] = text
            if title in contexts:
                # Context panels show a short original paragraph; reader keeps all prose.
                notes[context] = text.split('\n\n', 1)[0]
                chapter_title = f'{title} · {label}'
            elif title == 'Build Variants':
                chapter_title = f'Build variants · {label}'
            else:
                signature = (title, text)
                if signature in seen:
                    continue
                seen.add(signature)
                chapter_title = title
            sections.append({'title': chapter_title, 'text': text, 'context': context})
        stage_notes[str(index)] = notes
    if not sections:
        raise ValueError('Snapshot contains no published guide text')
    # Drop excerpt maps from the damaged copy; never mix old blanks with new text.
    guide.update(sections=sections, stageNotes=stage_notes, variants=descriptions,
                 items={}, gems={}, crafting={}, captureMode='rendered-original-text')
    first = stage_notes.get('0', {})
    for context in ('gear', 'skills', 'tree'):
        guide[context] = first.get(context, '')
    guide.pop('mana', None)
    result['guideText'] = guide
    build['guideText'] = copy.deepcopy(guide)
    build.setdefault('importNotes', []).append('Guide text refreshed from rendered publisher sections; inline labels retained separately for every variant.')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--build', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    with open(args.snapshot, encoding='utf-8') as f:
        snapshots = json.load(f)
    with open(args.build, encoding='utf-8') as f:
        build = json.load(f)
    result = repair_build(build, snapshots)
    with open(args.out, 'x', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f"Saved {len(result['guideText']['sections'])} original guide chapters")
