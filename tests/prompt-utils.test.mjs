// Tests for cli/prompts/prompt-utils.ts — the three reprompt-aware
// numbered-menu/yes-no helpers shared by every CLI wizard
// (init-prompts.ts, new-control-prompts.ts, attach-prompts.ts).
//
// The contract under test, per the "8C hardening" correction: empty input
// may accept a DOCUMENTED default; invalid, non-empty input must never
// silently become that default — it must reprompt instead, and the
// underlying Ask itself is what eventually ends a wizard that never
// supplies valid input (these helpers loop, they never invent an answer).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { askChoiceWithDefault, askRequiredChoice, askYesNo } = require(path.join(root, 'dist/cli/prompts/prompt-utils.js'));

function scriptedAsk(answers) {
  const queue = [...answers];
  const prompts = [];
  const ask = async (promptText) => {
    prompts.push(promptText);
    if (queue.length === 0) throw new Error(`scriptedAsk: ran out of answers (last prompt: ${JSON.stringify(promptText)})`);
    return queue.shift();
  };
  return { ask, prompts };
}

const swallowLogs = async (fn) => {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try { return await fn(); } finally { console.log = original; }
};

try {
  // --- askChoiceWithDefault: blank accepts the default ---
  {
    const { ask, prompts } = scriptedAsk(['']);
    const index = await askChoiceWithDefault(ask, 'Pick: ', 3, 0);
    assert.equal(index, 0);
    assert.equal(prompts.length, 1, 'blank input resolves immediately, no reprompt');
  }

  // --- askChoiceWithDefault: a valid explicit choice is used as-is (0-indexed) ---
  {
    const index = await askChoiceWithDefault(scriptedAsk(['2']).ask, 'Pick: ', 3, 0);
    assert.equal(index, 1);
  }

  // --- askChoiceWithDefault: invalid non-empty input REPROMPTS, never silently becomes the default ---
  {
    let calls = 0;
    const flaky = async () => { calls++; return calls === 1 ? '9' : calls === 2 ? 'nonsense' : '2'; };
    const index = await swallowLogs(() => askChoiceWithDefault(flaky, 'Pick: ', 3, 0));
    assert.equal(index, 1, 'eventually resolves to the valid explicit choice, not the default');
    assert.equal(calls, 3, 'asked again for each invalid answer instead of defaulting after the first');
  }

  // --- askChoiceWithDefault: out-of-range numbers (0, negative, too large) all reprompt ---
  {
    const { ask } = scriptedAsk(['0', '-1', '4', '1']);
    const index = await swallowLogs(() => askChoiceWithDefault(ask, 'Pick: ', 3, 2));
    assert.equal(index, 0);
  }

  // --- askRequiredChoice: NO default — blank reprompts too ---
  {
    const { ask, prompts } = scriptedAsk(['', '1']);
    const index = await swallowLogs(() => askRequiredChoice(ask, 'Pick: ', 2));
    assert.equal(index, 0);
    assert.equal(prompts.length, 2, 'blank input is invalid here and must reprompt, unlike askChoiceWithDefault');
  }

  // --- askRequiredChoice: invalid non-empty input reprompts ---
  {
    const index = await swallowLogs(() => askRequiredChoice(scriptedAsk(['abc', '0', '3', '2']).ask, 'Pick: ', 2));
    assert.equal(index, 1);
  }

  // --- askYesNo: blank accepts the documented default (both directions) ---
  {
    assert.equal(await askYesNo(scriptedAsk(['']).ask, 'Q?', true), true);
    assert.equal(await askYesNo(scriptedAsk(['']).ask, 'Q?', false), false);
  }

  // --- askYesNo: y/yes/n/no (case-insensitive) all resolve without reprompting ---
  {
    for (const [answer, expected] of [['y', true], ['Y', true], ['yes', true], ['YES', true], ['n', false], ['N', false], ['no', false]]) {
      const { ask, prompts } = scriptedAsk([answer]);
      assert.equal(await askYesNo(ask, 'Q?', false), expected, `"${answer}"`);
      assert.equal(prompts.length, 1, `"${answer}" resolves without reprompting`);
    }
  }

  // --- askYesNo: invalid non-empty input reprompts, never silently becomes the default ---
  {
    const result = await swallowLogs(() => askYesNo(scriptedAsk(['maybe', 'sure', 'n']).ask, 'Q?', true));
    assert.equal(result, false, 'eventually resolves to the explicit "n", not the true default');
  }

  // --- the prompt text itself is passed through unchanged (defaults/suffixes stay visible) ---
  {
    const { ask, prompts } = scriptedAsk(['y']);
    await askYesNo(ask, 'Use shadcn?', true);
    assert.equal(prompts[0], 'Use shadcn? [Y/n] ');
  }

  console.log('PASS prompt-utils: askChoiceWithDefault (blank->default, explicit choice, invalid input reprompts without defaulting, out-of-range numbers reprompt), askRequiredChoice (no default at all, blank reprompts too, invalid input reprompts), askYesNo (blank->documented default both directions, y/yes/n/no case-insensitively, invalid input reprompts, prompt suffix formatting)');
} finally {
  // no fixtures on disk to clean up — this file is pure in-memory helper coverage
}
