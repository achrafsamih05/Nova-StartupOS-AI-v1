// =====================================================================
// Nova StartupOS AI — Chat message sanitizer
// ---------------------------------------------------------------------
// Anthropic (and any provider strict about alternation) requires:
//
//   • EXACTLY ONE leading `system` message  (or none).
//     `system` must NOT appear in the middle of the conversation.
//   • The remaining messages must alternate user/assistant/user/...,
//     starting with `user` and ending with `user`.
//
// OpenAI is permissive but never penalizes us for sending a clean shape.
// So we always normalize. The normalizer is pure (no I/O, no globals)
// so it's trivially testable from `tests/run.js`.
//
// Rules applied (in order):
//   1. Drop messages with empty / whitespace-only content.
//   2. Coerce unknown roles to 'user'.
//   3. Concatenate every leading `system` message into ONE merged system
//      string; any later `system` is demoted to a `user` turn (its
//      content is appended to the next/previous user message).
//   4. Collapse consecutive same-role messages into one (joined by \n\n).
//   5. Ensure the conversation starts with `user`. If it starts with
//      `assistant`, prepend a synthetic short "Continue." user turn.
//   6. Ensure the conversation ends with `user`. If it ends with
//      `assistant`, drop trailing assistant turns (the caller is asking
//      us to generate the next assistant reply, so the last turn must
//      be the user prompt).
//
// Output:
//   { system: string|null, messages: [{role,content}, ...] }
//   where `messages` excludes the system role and is guaranteed to
//   alternate user/assistant/user/... starting and ending with `user`.
// =====================================================================

'use strict';

function _str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }
function _trim(s) { return _str(s).trim(); }

/**
 * Normalize a chat-message array to satisfy strict alternation rules.
 *
 * @param {Array<{role:string, content:string}>} input
 * @param {Object} [opts]
 * @param {string} [opts.placeholderUser='Continue.']
 *        Used if the cleaned conversation accidentally starts with an
 *        `assistant` turn (rare, but possible if the caller passes a
 *        canned greeting first).
 * @returns {{ system: string|null, messages: Array<{role:string, content:string}> }}
 */
function sanitizeMessages(input, opts) {
  opts = opts || {};
  const placeholderUser = opts.placeholderUser || 'Continue.';

  if (!Array.isArray(input) || !input.length) {
    return { system: null, messages: [] };
  }

  // 1+2: drop empties; coerce unknown roles.
  const KNOWN = { system: 1, user: 1, assistant: 1 };
  const cleaned = input.map(function (m) {
    const role = (m && KNOWN[m.role]) ? m.role : 'user';
    return { role: role, content: _trim(m && m.content) };
  }).filter(function (m) { return m.content.length > 0; });

  if (!cleaned.length) return { system: null, messages: [] };

  // 3: hoist all leading `system` into one merged system string. Any
  // mid-conversation `system` is demoted to a `user` turn.
  const systemParts = [];
  let i = 0;
  while (i < cleaned.length && cleaned[i].role === 'system') {
    systemParts.push(cleaned[i].content);
    i++;
  }
  const rest = [];
  for (; i < cleaned.length; i++) {
    if (cleaned[i].role === 'system') {
      // Demote mid-conversation system → user.
      rest.push({ role: 'user', content: cleaned[i].content });
    } else {
      rest.push(cleaned[i]);
    }
  }

  // 4: collapse consecutive same-role messages.
  const collapsed = [];
  for (let j = 0; j < rest.length; j++) {
    const cur = rest[j];
    const prev = collapsed[collapsed.length - 1];
    if (prev && prev.role === cur.role) {
      prev.content = prev.content + '\n\n' + cur.content;
    } else {
      collapsed.push({ role: cur.role, content: cur.content });
    }
  }

  // 5: must start with `user`. If it starts with `assistant`, prepend
  // a synthetic short user turn so the alternation is well-formed.
  if (collapsed.length && collapsed[0].role === 'assistant') {
    collapsed.unshift({ role: 'user', content: placeholderUser });
  }

  // 6: must end with `user`. Drop trailing `assistant` turns — the LLM
  // is being asked to generate the next assistant reply.
  while (collapsed.length && collapsed[collapsed.length - 1].role === 'assistant') {
    collapsed.pop();
  }

  // Final defensive sweep: re-collapse if popping the trailing assistant
  // exposed two consecutive users (shouldn't happen but cheap to verify).
  const final = [];
  for (let k = 0; k < collapsed.length; k++) {
    const cur = collapsed[k];
    const prev = final[final.length - 1];
    if (prev && prev.role === cur.role) {
      prev.content = prev.content + '\n\n' + cur.content;
    } else {
      final.push(cur);
    }
  }

  return {
    system: systemParts.length ? systemParts.join('\n\n') : null,
    messages: final,
  };
}

module.exports = { sanitizeMessages };
