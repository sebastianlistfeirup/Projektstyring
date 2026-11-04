#!/usr/bin/env node
// Controlled CLI fixture for the browser/HTTP tests. Not a real AI provider.
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
const emit = event => process.stdout.write(JSON.stringify(event) + '\n');
let question = false;
if (process.argv.includes('--version')) { console.log('orbit-permission-fixture 1'); process.exit(0); }
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.type === 'control_request') emit({ type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: {} } });
  if (message.type === 'user') {
    question = message.message.content.includes('QUESTION_FIXTURE');
    emit({ type: 'control_request', request_id: 'native-permission', request: question
      ? { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ question: 'Hvilken reference gælder?', options: [{ label: 'Realmread', description: 'Den vedtagne byreference' }] }] } }
      : { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'godot --headless --path . --script tests/run_tests.gd' }, decision_reason: 'Kontrollen kræver din tilladelse.' } });
  }
  if (message.type === 'control_response') {
    const allowed = message.response.response.behavior === 'allow';
    if (question && allowed && message.response.response.updatedInput.answers['Hvilken reference gælder?'] !== 'Realmread') process.exit(12);
    if (allowed) writeFileSync('game.txt', 'fixed');
    const result = allowed ? 'Kontrollen er udført.\nORBIT_JOB_STATUS: {"status":"delivered","reason":"Fixture udført"}' : 'ORBIT_JOB_STATUS: {"status":"blocked","reason":"Tilladelse afvist"}';
    emit({ type: 'assistant', message: { content: [{ type: 'text', text: result }] } });
    emit({ type: 'result', result, permission_denials: allowed ? [] : [{ tool_name: 'Bash' }] });
  }
});
