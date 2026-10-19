import unittest
from mobalytics_snapshot import rendered_text, repair_build

class SnapshotTests(unittest.TestCase):
    def test_inline_names_and_line_breaks(self):
        markup = '<p>Priority: <span contenteditable="false"><img alt=""><span>Skill A</span></span> -&gt; <span>Skill B</span><br>Quality: Skill C</p><p>Pre-place <span>Skill D</span>, cast <span>Skill E</span>.</p>'
        self.assertEqual(rendered_text(markup), 'Priority: Skill A -> Skill B\nQuality: Skill C\n\nPre-place Skill D, cast Skill E.')

    def test_ignores_scripts_and_decodes_entities(self):
        self.assertEqual(rendered_text('<p>Original &amp; unchanged.<script>bad()</script><br><img alt="Named gem"></p>'), 'Original & unchanged.\nNamed gem')

    def test_no_cross_variant_fallback_or_source_mutation(self):
        source = {'format':'tavora.build','formatVersion':1,'build':{'stages':[{'label':'Early'},{'label':'Late'}]},'guideText':{'skills':'Old blanks'}}
        snapshots = [{'label':'Early','sections':[{'title':'Skill Gems','selected':['Early'],'editors':['<p>Early skill</p>']}]},{'label':'Late','sections':[{'title':'Skill Gems','selected':['Late'],'editors':[]}]}]
        repaired = repair_build(source,snapshots)
        self.assertEqual(repaired['guideText']['stageNotes']['0']['skills'],'Early skill')
        self.assertNotIn('skills',repaired['guideText']['stageNotes']['1'])
        self.assertEqual(source['guideText']['skills'],'Old blanks')
        snapshots[1]['sections'][0]['selected']=['Early']
        with self.assertRaises(ValueError):repair_build(source,snapshots)

if __name__ == '__main__':unittest.main()
