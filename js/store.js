/* =====================================================================
   Nova StartupOS AI - Persistence layer (NovaStore)
   localStorage-backed state with a single source of truth.
   Entities: settings, workspaces, startups, conversations, memory.
   No backend required for the MVP; structured so a REST/Supabase
   backend can replace the localStorage adapter without touching callers.
   ===================================================================== */
(function (global) {
  'use strict';

  var KEY = 'nova.state.v1';

  var DEFAULT_STATE = {
    version: 1,
    onboarded: false,
    activeWorkspaceId: null,
    activeStartupId: null,
    settings: {
      apiKey: '',                              // OpenRouter key (stored locally only)
      model: 'anthropic/claude-sonnet-4',
      demoMode: true,                          // demo mode ON until a key is added
      theme: 'dark',
      emailNotifications: true,
      weeklyReport: false
    },
    user: { name: 'Founder', email: '', company: '', country: '' },
    workspaces: [],
    startups: [],
    conversations: [],
    memory: {}                                 // keyed by startupId -> [{k,v}]
  };

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var state = null;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        state = Object.assign(clone(DEFAULT_STATE), JSON.parse(raw));
        // deep-merge settings so new defaults appear on upgrade
        state.settings = Object.assign(clone(DEFAULT_STATE.settings), state.settings || {});
        return state;
      }
    } catch (e) { console.warn('NovaStore: load failed, resetting', e); }
    state = clone(DEFAULT_STATE);
    return state;
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.warn('NovaStore: persist failed', e); }
    emit();
  }

  // --- simple pub/sub so UI can react to data changes ---
  var listeners = [];
  function subscribe(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (l) { return l !== fn; }); }; }
  function emit() { listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } }); }

  /* ----------------------------- Settings ----------------------------- */
  function getSettings() { return clone(state.settings); }
  function updateSettings(patch) { Object.assign(state.settings, patch); persist(); return getSettings(); }

  function getUser() { return clone(state.user); }
  function updateUser(patch) { Object.assign(state.user, patch); persist(); return getUser(); }

  /* ---------------------------- Workspaces ----------------------------- */
  function getWorkspaces() { return clone(state.workspaces); }
  function getActiveWorkspace() { return state.workspaces.find(function (w) { return w.id === state.activeWorkspaceId; }) || null; }
  function createWorkspace(data) {
    var ws = Object.assign({ id: uid('ws'), name: 'My Workspace', createdAt: Date.now() }, data || {});
    state.workspaces.push(ws);
    if (!state.activeWorkspaceId) state.activeWorkspaceId = ws.id;
    persist();
    return clone(ws);
  }
  function setActiveWorkspace(id) { state.activeWorkspaceId = id; persist(); }

  /* ----------------------------- Startups ------------------------------ */
  function getStartups(workspaceId) {
    var list = state.startups;
    if (workspaceId) list = list.filter(function (s) { return s.workspaceId === workspaceId; });
    return clone(list);
  }
  function getStartup(id) { return clone(state.startups.find(function (s) { return s.id === id; }) || null); }
  function getActiveStartup() { return getStartup(state.activeStartupId); }
  function setActiveStartup(id) { state.activeStartupId = id; persist(); }
  function createStartup(data) {
    var s = Object.assign({
      id: uid('st'),
      workspaceId: state.activeWorkspaceId,
      name: 'Untitled Startup',
      industry: 'SaaS',
      country: '',
      market: '',
      problem: '',
      solution: '',
      stage: 'Idea',
      score: 0,
      scores: { innovation: 0, scalability: 0, market: 0, investment: 0 },
      plan: null,
      deck: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }, data || {});
    state.startups.push(s);
    state.activeStartupId = s.id;
    persist();
    return clone(s);
  }
  function updateStartup(id, patch) {
    var s = state.startups.find(function (x) { return x.id === id; });
    if (!s) return null;
    Object.assign(s, patch, { updatedAt: Date.now() });
    persist();
    return clone(s);
  }
  function deleteStartup(id) {
    state.startups = state.startups.filter(function (s) { return s.id !== id; });
    if (state.activeStartupId === id) state.activeStartupId = state.startups[0] ? state.startups[0].id : null;
    persist();
  }

  /* --------------------------- Conversations --------------------------- */
  function getConversations() {
    return clone(state.conversations).sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  }
  function getConversation(id) { return clone(state.conversations.find(function (c) { return c.id === id; }) || null); }
  function createConversation(title) {
    var c = { id: uid('cv'), title: title || 'New chat', messages: [], startupId: state.activeStartupId, createdAt: Date.now(), updatedAt: Date.now() };
    state.conversations.push(c);
    persist();
    return clone(c);
  }
  function appendMessage(convId, message) {
    var c = state.conversations.find(function (x) { return x.id === convId; });
    if (!c) return null;
    c.messages.push(message);
    c.updatedAt = Date.now();
    // auto-title from first user message
    if (c.title === 'New chat' && message.role === 'user') {
      c.title = message.content.slice(0, 42) + (message.content.length > 42 ? '…' : '');
    }
    persist();
    return clone(c);
  }
  function deleteConversation(id) {
    state.conversations = state.conversations.filter(function (c) { return c.id !== id; });
    persist();
  }

  /* ----------------------------- Memory -------------------------------- */
  // Project memory: durable facts the Copilot should always know.
  function getMemory(startupId) { return clone(state.memory[startupId] || []); }
  function addMemory(startupId, fact) {
    if (!state.memory[startupId]) state.memory[startupId] = [];
    state.memory[startupId].push({ id: uid('m'), text: fact, at: Date.now() });
    persist();
  }
  function clearMemory(startupId) { delete state.memory[startupId]; persist(); }

  /* ------------------------------ Reset -------------------------------- */
  function reset() { state = clone(DEFAULT_STATE); persist(); }
  function raw() { return clone(state); }

  global.NovaStore = {
    load: load, persist: persist, subscribe: subscribe, reset: reset, raw: raw, uid: uid,
    getSettings: getSettings, updateSettings: updateSettings,
    getUser: getUser, updateUser: updateUser,
    getWorkspaces: getWorkspaces, getActiveWorkspace: getActiveWorkspace, createWorkspace: createWorkspace, setActiveWorkspace: setActiveWorkspace,
    getStartups: getStartups, getStartup: getStartup, getActiveStartup: getActiveStartup, setActiveStartup: setActiveStartup,
    createStartup: createStartup, updateStartup: updateStartup, deleteStartup: deleteStartup,
    getConversations: getConversations, getConversation: getConversation, createConversation: createConversation, appendMessage: appendMessage, deleteConversation: deleteConversation,
    getMemory: getMemory, addMemory: addMemory, clearMemory: clearMemory
  };

  load();
})(window);
