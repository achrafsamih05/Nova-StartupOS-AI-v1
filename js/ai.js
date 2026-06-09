/* =====================================================================
   Nova StartupOS AI — AI engine (NovaAI) v2

   All AI traffic goes through the secure server proxy at /api/ai-stream.
   No browser-stored provider keys, no demo / mock fallback. If the user
   is not signed in, calls reject explicitly.
   ===================================================================== */
(function (global) {
  'use strict';

  var SYSTEM_PROMPT =
    "You are Nova, an AI co-founder inside Nova StartupOS AI, a platform that helps " +
    "founders turn ideas into investment-ready startups. You help with business plans, " +
    "pitch decks, startup readiness, fundraising strategy, and startup-visa guidance. " +
    "Be concise, structured, practical, and encouraging. Prefer short paragraphs and " +
    "bullet points. When asked to produce documents, use clear section headings.";

  function buildSystemPrompt(context) {
    var s = SYSTEM_PROMPT;
    if (context && context.startup) {
      var st = context.startup;
      s += "\n\nActive startup context:\n";
      s += "- Name: " + (st.name || 'n/a') + "\n";
      s += "- Industry: " + (st.industry || 'n/a') + "\n";
      s += "- Country: " + (st.country || 'n/a') + "\n";
      s += "- Target market: " + (st.market || 'n/a') + "\n";
      s += "- Problem: " + (st.problem || 'n/a') + "\n";
      s += "- Solution: " + (st.solution || 'n/a') + "\n";
      s += "- Stage: " + (st.stage || 'n/a') + ", Readiness score: " + (st.score || 0) + "/100";
    }
    if (context && context.memory && context.memory.length) {
      s += "\n\nDurable project memory (always honor these facts):\n";
      s += context.memory.map(function (m) { return "- " + m.text; }).join("\n");
    }
    return s;
  }

  // The Copilot is "live" whenever the user is authenticated.
  function isConfigured() {
    return !!(global.NovaApi && global.NovaApi.supabase);
  }

  /**
   * Stream an AI generation through the secure backend.
   * @param {string}   prompt        The user prompt / instruction.
   * @param {string}   systemPrompt  Optional client-supplied context.
   * @param {function} onChunk       Called with each text delta as it streams.
   * @param {function} onDone        Called once with the full text when complete.
   * @param {function} onError       Called with an Error on any failure.
   * @param {Object}   [opts]        Optional { signal } AbortSignal.
   */
  async function generateStream(prompt, systemPrompt, onChunk, onDone, onError, opts) {
    opts = opts || {};
    try {
      if (!global.NovaApi || typeof global.NovaApi.aiStream !== 'function') {
        throw new Error('AI client is not initialized.');
      }
      return await global.NovaApi.aiStream(prompt, {
        systemPrompt: systemPrompt,
        signal: opts.signal,
        onChunk: onChunk,
        onDone: onDone,
        onError: onError,
      });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      if (onError) onError(e);
    }
  }

  /**
   * Convenience wrapper for chat-style invocations.
   * @param {Array} messages  [{role, content}]
   * @param {Object} opts      { context, onToken(textDelta), signal }
   */
  async function chat(messages, opts) {
    opts = opts || {};
    // Use the most recent user message as the prompt; the rest of the history
    // is encoded into the system prompt under "Conversation so far" to keep
    // wire format simple.
    var system = buildSystemPrompt(opts.context);
    var historyLines = [];
    var userPrompt = '';
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i];
      if (i === messages.length - 1 && m.role === 'user') { userPrompt = m.content; }
      else { historyLines.push((m.role === 'assistant' ? 'Nova' : 'User') + ': ' + m.content); }
    }
    if (historyLines.length) {
      system += "\n\nConversation so far:\n" + historyLines.join("\n");
    }
    var full = '';
    await generateStream(
      userPrompt,
      system,
      function (delta) { full += delta; if (opts.onToken) opts.onToken(delta); },
      null,
      function (err) { throw err; },
      { signal: opts.signal }
    );
    return full;
  }

  global.NovaAI = {
    chat: chat,
    generateStream: generateStream,
    isConfigured: isConfigured,
    buildSystemPrompt: buildSystemPrompt,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    // Models offered in the Settings → AI Engine selector. Order matches
    // the server's automatic fallback chain so users see what Nova will
    // try first. Keep this list in sync with api/_lib/aiProviders.js.
    MODELS: [
      { id: 'anthropic/claude-sonnet-4',           label: 'Claude Sonnet 4 (recommended)' },
      { id: 'google/gemini-2.5-pro',               label: 'Gemini 2.5 Pro' },
      { id: 'openai/gpt-4o',                       label: 'GPT-4o' },
      { id: 'openai/gpt-4o-mini',                  label: 'GPT-4o mini (fast, cheap)' },
      { id: 'deepseek/deepseek-chat',              label: 'DeepSeek Chat' },
    ],
  };
})(window);
