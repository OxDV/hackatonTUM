import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseExtraction} from './client.mjs';
test('regression: ready extraction without documents is rejected',()=>{
 const parsed=parseExtraction('```json\n{"status":"ready","offer":null,"invoice":null,"extraction_issues":[]}\n```');
 assert.equal(JSON.parse(parsed.json).status,'needs_review');
 assert.notEqual(parsed.unparsed,null);
 const invalid=parseExtraction('not json');
 assert.equal(JSON.parse(invalid.json).status,'needs_review');
 assert.equal(invalid.unparsed,'not json');
});
