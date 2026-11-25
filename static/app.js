(() => {
  const STORAGE_CHATS = "aries_ai_chats_v1";
  const STORAGE_SETTINGS = "aries_ai_settings_v1";
  const STORAGE_THEME = "aries_ai_theme_v1";

  const state = {
    chats: [],
    activeChatId: null,
    searchQuery: "",
    isStreaming: false,
    abortController: null,
    theme: "light",
    defaults: {
      max_tokens: 768,
      temperature: 0.6,
      system_prompt:
        "You are Aries AI: intelligent, friendly, witty, and direct. " +
        "Explain technical concepts clearly, write clean debuggable Python code, " +
        "and format answers neatly in Markdown. Be concise and avoid filler.",
    },
    settings: null,
  };

  // DOM References
  const el = {
    sidebar: document.getElementById("sidebar"),
    backdrop: document.getElementById("sidebar-backdrop"),
    toggleSidebarBtn: document.getElementById("toggle-sidebar-btn"),
    closeSidebarBtn: document.getElementById("close-sidebar-btn"),
    newChatBtn: document.getElementById("new-chat-btn"),
    chatSearchInput: document.getElementById("chat-search-input"),
    chatCountPill: document.getElementById("chat-count-pill"),
    clearChatBtn: document.getElementById("clear-chat-btn"),
    themeToggleBtn: document.getElementById("theme-toggle-btn"),
    chatList: document.getElementById("chat-list"),
    chatTitle: document.getElementById("chat-title"),
    tokenBadge: document.getElementById("token-badge"),
    headerModelText: document.getElementById("header-model-text"),
    sidebarTokenMeta: document.getElementById("sidebar-token-meta"),
    statusPill: document.getElementById("status-pill"),
    statusText: document.getElementById("status-text"),
    sidebarModelLabel: document.getElementById("sidebar-model-label"),
    welcomeModelKicker: document.getElementById("welcome-model-kicker"),
    chatScroll: document.getElementById("chat-scroll"),
    welcomeScreen: document.getElementById("welcome-screen"),
    messages: document.getElementById("messages"),
    scrollBottomBtn: document.getElementById("scroll-bottom-btn"),
    chatForm: document.getElementById("chat-form"),
    promptInput: document.getElementById("prompt-input"),
    sendBtn: document.getElementById("send-btn"),
    charCount: document.getElementById("char-count"),
    settingsModal: document.getElementById("settings-modal"),
    openSettingsBtn: document.getElementById("open-settings-btn"),
    closeSettingsBtn: document.getElementById("close-settings-btn"),
    maxTokensRange: document.getElementById("max-tokens-range"),
    maxTokensValue: document.getElementById("max-tokens-value"),
    temperatureRange: document.getElementById("temperature-range"),
    temperatureValue: document.getElementById("temperature-value"),
    systemPromptInput: document.getElementById("system-prompt-input"),
    resetSettingsBtn: document.getElementById("reset-settings-btn"),
    saveSettingsBtn: document.getElementById("save-settings-btn"),
  };

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function highlightCode(rawCode, lang) {
    let html = escapeHtml(rawCode);
    const normalized = (lang || "").toLowerCase();
    const codeLanguages = ["python", "py", "javascript", "js", "ts", "typescript", "bash", "sh", "json"];
    if (!codeLanguages.includes(normalized)) {
      return html;
    }

    const tokens = [];
    const stash = (cls, text) => {
      const key = `\u0000${tokens.length}\u0000`;
      tokens.push(`<span class="${cls}">${text}</span>`);
      return key;
    };

    html = html.replace(/(#[^\n]*|\/\/[^\n]*)/g, (m) => stash("tok-cmt", m));
    html = html.replace(/(&quot;(?:(?!&quot;)[^\n])*?&quot;|&#39;(?:(?!&#39;)[^\n])*?&#39;)/g, (m) => stash("tok-str", m));
    html = html.replace(
      /\b(def|class|return|if|elif|else|for|while|in|import|from|as|try|except|finally|with|yield|async|await|lambda|True|False|None|const|let|var|function|export|default|switch|case|break)\b/g,
      '<span class="tok-kw">$1</span>'
    );
    html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
    html = html.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)(?=\()/g, '<span class="tok-fn">$1</span>');
    html = html.replace(/\u0000(\d+)\u0000/g, (_, idx) => tokens[Number(idx)]);
    return html;
  }

  function renderInline(text) {
    const inlineCode = [];
    let out = escapeHtml(text).replace(/`([^`]+)`/g, (_, code) => {
      const token = `\u0001${inlineCode.length}\u0001`;
      inlineCode.push(`<code class="inline-code">${code}</code>`);
      return token;
    });

    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    out = out.replace(/\u0001(\d+)\u0001/g, (_, idx) => inlineCode[Number(idx)]);
    return out;
  }

  function renderMarkdown(markdown) {
    if (!markdown) return "";

    const codeBlocks = [];
    const normalized = markdown.replace(/\r\n/g, "\n");
    const withPlaceholders = normalized.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const cleanLang = (lang || "text").trim();
      const idx = codeBlocks.length;
      const trimmedCode = code.replace(/\n$/, "");
      codeBlocks.push(
        `<div class="code-block" data-code-idx="${idx}">` +
          `<div class="code-header">` +
            `<span>${escapeHtml(cleanLang)}</span>` +
            `<button class="copy-code-btn" type="button" data-raw="${escapeHtml(trimmedCode)}">Copy</button>` +
          `</div>` +
          `<pre><code>${highlightCode(trimmedCode, cleanLang)}</code></pre>` +
        `</div>`
      );
      return `\n\u0002CODE${idx}\u0002\n`;
    });

    const lines = withPlaceholders.split("\n");
    const chunks = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        i++;
        continue;
      }

      const codeMatch = trimmed.match(/^\u0002CODE(\d+)\u0002$/);
      if (codeMatch) {
        chunks.push(codeBlocks[Number(codeMatch[1])]);
        i++;
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        chunks.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
        i++;
        continue;
      }

      if (/^---+$/.test(trimmed)) {
        chunks.push("<hr />");
        i++;
        continue;
      }

      if (trimmed.startsWith(">")) {
        const quoteLines = [];
        while (i < lines.length && lines[i].trim().startsWith(">")) {
          quoteLines.push(renderInline(lines[i].trim().replace(/^>\s?/, "")));
          i++;
        }
        chunks.push(`<blockquote>${quoteLines.join("<br />")}</blockquote>`);
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          items.push(`<li>${renderInline(lines[i].trim().replace(/^[-*]\s+/, ""))}</li>`);
          i++;
        }
        chunks.push(`<ul>${items.join("")}</ul>`);
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(`<li>${renderInline(lines[i].trim().replace(/^\d+\.\s+/, ""))}</li>`);
          i++;
        }
        chunks.push(`<ol>${items.join("")}</ol>`);
        continue;
      }

      if (trimmed.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
        const parseRow = (row) =>
          row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => renderInline(c.trim()));
        const headers = parseRow(trimmed);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim().includes("|")) {
          rows.push(parseRow(lines[i]));
          i++;
        }
        const thead = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;
        const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>`;
        chunks.push(`<table>${thead}${tbody}</table>`);
        continue;
      }

      const para = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,4}\s+|[-*]\s+|\d+\.\s+|>\s?|---+$|\u0002CODE\d+\u0002$)/.test(lines[i].trim())
      ) {
        para.push(renderInline(lines[i].trim()));
        i++;
      }
      chunks.push(`<p>${para.join("<br />")}</p>`);
    }

    return chunks.join("");
  }

  function applyTheme(theme) {
    state.theme = theme === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", state.theme);
    localStorage.setItem(STORAGE_THEME, state.theme);
  }

  function loadStorage() {
    const savedTheme = localStorage.getItem(STORAGE_THEME);
    applyTheme(savedTheme || "light");

    try {
      const savedSettings = JSON.parse(localStorage.getItem(STORAGE_SETTINGS) || "null");
      state.settings = { ...state.defaults, ...(savedSettings || {}) };
    } catch {
      state.settings = { ...state.defaults };
    }

    try {
      const savedChats = JSON.parse(localStorage.getItem(STORAGE_CHATS) || "[]");
      state.chats = Array.isArray(savedChats) ? savedChats : [];
    } catch {
      state.chats = [];
    }

    if (state.chats.length === 0) {
      createNewChat(false);
    } else {
      state.activeChatId = state.chats[0].id;
    }
  }

  function persistChats() {
    localStorage.setItem(STORAGE_CHATS, JSON.stringify(state.chats.slice(0, 30)));
  }

  function persistSettings() {
    localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(state.settings));
  }

  function getActiveChat() {
    return state.chats.find((c) => c.id === state.activeChatId) || state.chats[0];
  }

  function createNewChat(render = true) {
    if (state.isStreaming) stopStreaming();
    const chat = {
      id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: "New Chat",
      messages: [],
    };
    state.chats.unshift(chat);
    state.activeChatId = chat.id;
    persistChats();
    if (render) {
      renderSidebar();
      renderActiveChat();
      closeMobileSidebar();
      el.promptInput.focus();
    }
  }

  function deleteChat(chatId) {
    if (state.isStreaming && state.activeChatId === chatId) {
      stopStreaming();
    }
    state.chats = state.chats.filter((c) => c.id !== chatId);
    if (state.chats.length === 0) {
      createNewChat(false);
    } else if (state.activeChatId === chatId) {
      state.activeChatId = state.chats[0].id;
    }
    persistChats();
    renderSidebar();
    renderActiveChat();
  }

  function renderSidebar() {
    el.chatList.innerHTML = "";
    const query = state.searchQuery.trim().toLowerCase();
    const filtered = query
      ? state.chats.filter((chat) => {
          const titleMatch = (chat.title || "").toLowerCase().includes(query);
          const msgMatch = (chat.messages || []).some((m) =>
            (m.content || "").toLowerCase().includes(query)
          );
          return titleMatch || msgMatch;
        })
      : state.chats;

    if (el.chatCountPill) {
      el.chatCountPill.textContent = String(filtered.length);
    }

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "chat-empty-search";
      empty.textContent = "No matching conversations";
      el.chatList.appendChild(empty);
      return;
    }

    for (const chat of filtered) {
      const btn = document.createElement("div");
      btn.className = `chat-item${chat.id === state.activeChatId ? " active" : ""}`;
      btn.setAttribute("role", "button");
      btn.tabIndex = 0;

      const titleSpan = document.createElement("span");
      titleSpan.className = "chat-item-title";
      titleSpan.textContent = chat.title || "New Chat";

      const delBtn = document.createElement("button");
      delBtn.className = "chat-item-delete";
      delBtn.type = "button";
      delBtn.setAttribute("aria-label", "Delete conversation");
      delBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

      btn.addEventListener("click", (e) => {
        if (e.target.closest(".chat-item-delete")) return;
        if (state.isStreaming) stopStreaming();
        state.activeChatId = chat.id;
        renderSidebar();
        renderActiveChat();
        closeMobileSidebar();
      });

      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteChat(chat.id);
      });

      btn.appendChild(titleSpan);
      btn.appendChild(delBtn);
      el.chatList.appendChild(btn);
    }
  }

  function renderAssistantBodyContent(bodyEl, msg) {
    bodyEl.className = `assistant-body${msg.isError ? " error-state" : ""}`;
    if (msg.streaming && !msg.content) {
      bodyEl.innerHTML = '<div class="loading-dots" aria-label="Generating"><span></span><span></span><span></span></div>';
      return;
    }
    bodyEl.innerHTML = renderMarkdown(msg.content);
    if (msg.streaming) {
      const cursor = document.createElement("span");
      cursor.className = "streaming-cursor";
      bodyEl.appendChild(cursor);
    }
  }

  function buildMessageNode(msg, index, total) {
    const row = document.createElement("div");
    row.className = `msg-row ${msg.role}`;

    if (msg.role === "user") {
      const bubble = document.createElement("div");
      bubble.className = "user-bubble";
      bubble.textContent = msg.content;
      row.appendChild(bubble);
      return row;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "assistant-row";

    const avatar = document.createElement("div");
    avatar.className = "assistant-avatar";
    avatar.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>';

    const body = document.createElement("div");
    renderAssistantBodyContent(body, msg);

    wrapper.appendChild(avatar);
    wrapper.appendChild(body);
    row.appendChild(wrapper);

    if (!msg.streaming && msg.content) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";

      const copyBtn = document.createElement("button");
      copyBtn.className = "msg-action-btn";
      copyBtn.type = "button";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(msg.content);
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1400);
      });
      actions.appendChild(copyBtn);

      if (index === total - 1) {
        const regenBtn = document.createElement("button");
        regenBtn.className = "msg-action-btn";
        regenBtn.type = "button";
        regenBtn.textContent = "Regenerate";
        regenBtn.addEventListener("click", regenerateLastReply);
        actions.appendChild(regenBtn);
      }

      row.appendChild(actions);
    }

    return row;
  }

  function renderActiveChat(scrollToEnd = true) {
    const chat = getActiveChat();
    const hasMessages = chat.messages.length > 0;
    el.chatTitle.textContent = hasMessages ? chat.title : "New Chat";
    el.welcomeScreen.hidden = hasMessages;
    el.messages.innerHTML = "";

    chat.messages.forEach((msg, idx) => {
      el.messages.appendChild(buildMessageNode(msg, idx, chat.messages.length));
    });

    if (scrollToEnd) {
      scrollToBottom();
    }
  }

  function scrollToBottom() {
    el.chatScroll.scrollTop = el.chatScroll.scrollHeight;
  }

  function isNearBottom() {
    return el.chatScroll.scrollHeight - el.chatScroll.scrollTop - el.chatScroll.clientHeight < 120;
  }

  function updateComposerState() {
    const val = el.promptInput.value;
    el.charCount.textContent = `${val.length} chars`;
    el.promptInput.style.height = "auto";
    el.promptInput.style.height = `${Math.min(el.promptInput.scrollHeight, 180)}px`;

    if (state.isStreaming) {
      el.sendBtn.disabled = false;
      el.sendBtn.classList.add("streaming");
      el.sendBtn.setAttribute("aria-label", "Stop generation");
    } else {
      el.sendBtn.classList.remove("streaming");
      el.sendBtn.disabled = val.trim().length === 0;
      el.sendBtn.setAttribute("aria-label", "Send message");
    }
  }

  function stopStreaming() {
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = null;
    }
    state.isStreaming = false;
    const chat = getActiveChat();
    const last = chat.messages[chat.messages.length - 1];
    if (last && last.streaming) {
      last.streaming = false;
      if (!last.content) {
        last.content = "_Generation stopped._";
      }
      persistChats();
      renderActiveChat(false);
    }
    updateComposerState();
  }

  async function sendMessage(rawText) {
    const text = rawText.trim();
    if (!text || state.isStreaming) return;

    const chat = getActiveChat();
    const priorHistory = chat.messages
      .filter((m) => !m.isError)
      .map((m) => ({ role: m.role, content: m.content }));

    if (chat.messages.length === 0) {
      chat.title = text.length > 42 ? `${text.slice(0, 42)}...` : text;
    }

    chat.messages.push({ role: "user", content: text });
    const assistantMsg = { role: "assistant", content: "", streaming: true, isError: false };
    chat.messages.push(assistantMsg);

    el.promptInput.value = "";
    state.isStreaming = true;
    state.abortController = new AbortController();
    updateComposerState();
    renderSidebar();
    renderActiveChat(true);

    let rafPending = false;
    const scheduleRender = () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        const shouldStick = isNearBottom();
        const bodyNodes = el.messages.querySelectorAll(".assistant-body");
        const targetBody = bodyNodes[bodyNodes.length - 1];
        if (targetBody) {
          renderAssistantBodyContent(targetBody, assistantMsg);
        }
        if (shouldStick) scrollToBottom();
      });
    };

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: state.abortController.signal,
        body: JSON.stringify({
          message: text,
          history: priorHistory,
          max_tokens: Number(state.settings.max_tokens),
          temperature: Number(state.settings.temperature),
          system_prompt: state.settings.system_prompt,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";

        for (const frame of frames) {
          const dataLine = frame
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!dataLine) continue;

          const event = JSON.parse(dataLine.slice(6));
          if (event.type === "delta") {
            assistantMsg.content += event.content;
            scheduleRender();
          } else if (event.type === "error") {
            assistantMsg.isError = true;
            assistantMsg.content = event.message || "An error occurred.";
            scheduleRender();
          }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        assistantMsg.isError = true;
        assistantMsg.content = "Could not reach the server. Make sure `python3 app.py` is running.";
      }
    } finally {
      assistantMsg.streaming = false;
      state.isStreaming = false;
      state.abortController = null;
      persistChats();
      renderActiveChat(false);
      updateComposerState();
    }
  }

  function regenerateLastReply() {
    if (state.isStreaming) return;
    const chat = getActiveChat();
    if (chat.messages.length < 2) return;
    if (chat.messages[chat.messages.length - 1].role === "assistant") {
      chat.messages.pop();
    }
    const lastUser = chat.messages.pop();
    if (lastUser && lastUser.role === "user") {
      sendMessage(lastUser.content);
    }
  }

  function closeMobileSidebar() {
    el.sidebar.classList.remove("open");
    el.backdrop.classList.remove("visible");
  }

  function syncSettingsUI() {
    el.maxTokensRange.value = state.settings.max_tokens;
    el.maxTokensValue.textContent = state.settings.max_tokens;
    el.temperatureRange.value = state.settings.temperature;
    el.temperatureValue.textContent = Number(state.settings.temperature).toFixed(1);
    el.systemPromptInput.value = state.settings.system_prompt;
    el.tokenBadge.textContent = `${state.settings.max_tokens} tok`;
    if (el.sidebarTokenMeta) {
      el.sidebarTokenMeta.textContent = `Max ${state.settings.max_tokens} tokens · Streaming`;
    }
  }

  async function checkHealth() {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      if (data.model) {
        if (el.sidebarModelLabel) el.sidebarModelLabel.textContent = data.model;
        if (el.headerModelText) el.headerModelText.textContent = data.model;
        if (el.welcomeModelKicker) el.welcomeModelKicker.textContent = `Aries AI · ${data.model}`;
      }
      if (data.defaults) {
        state.defaults = data.defaults;
      }
      if (data.status === "ready") {
        el.statusPill.className = "status-pill ready";
        el.statusText.textContent = "Online";
      } else {
        el.statusPill.className = "status-pill warn";
        el.statusText.textContent = "Key Needed";
      }
    } catch {
      el.statusPill.className = "status-pill warn";
      el.statusText.textContent = "Offline";
    }
  }

  function bindEvents() {
    el.promptInput.addEventListener("input", updateComposerState);

    el.promptInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (!state.isStreaming && el.promptInput.value.trim()) {
          sendMessage(el.promptInput.value);
        }
      }
    });

    el.chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (state.isStreaming) {
        stopStreaming();
      } else {
        sendMessage(el.promptInput.value);
      }
    });

    document.querySelectorAll(".starter-card").forEach((card) => {
      card.addEventListener("click", () => {
        const prompt = card.getAttribute("data-prompt");
        if (prompt) sendMessage(prompt);
      });
    });

    el.messages.addEventListener("click", async (e) => {
      const copyCodeBtn = e.target.closest(".copy-code-btn");
      if (!copyCodeBtn) return;
      const raw = copyCodeBtn.getAttribute("data-raw") || "";
      await navigator.clipboard.writeText(raw);
      copyCodeBtn.textContent = "Copied!";
      setTimeout(() => (copyCodeBtn.textContent = "Copy"), 1400);
    });

    el.chatSearchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value || "";
      renderSidebar();
    });

    el.newChatBtn.addEventListener("click", () => createNewChat(true));

    el.clearChatBtn.addEventListener("click", () => {
      if (state.isStreaming) stopStreaming();
      const chat = getActiveChat();
      chat.messages = [];
      chat.title = "New Chat";
      persistChats();
      renderSidebar();
      renderActiveChat();
    });

    el.themeToggleBtn.addEventListener("click", () => {
      applyTheme(state.theme === "dark" ? "light" : "dark");
    });

    el.toggleSidebarBtn.addEventListener("click", () => {
      if (window.innerWidth <= 768) {
        el.sidebar.classList.toggle("open");
        el.backdrop.classList.toggle("visible");
      } else {
        el.sidebar.classList.toggle("collapsed");
      }
    });

    el.closeSidebarBtn.addEventListener("click", closeMobileSidebar);
    el.backdrop.addEventListener("click", closeMobileSidebar);

    el.chatScroll.addEventListener("scroll", () => {
      el.scrollBottomBtn.hidden = isNearBottom();
    });
    el.scrollBottomBtn.addEventListener("click", scrollToBottom);

    el.openSettingsBtn.addEventListener("click", () => {
      syncSettingsUI();
      el.settingsModal.hidden = false;
    });
    el.closeSettingsBtn.addEventListener("click", () => (el.settingsModal.hidden = true));
    el.settingsModal.addEventListener("click", (e) => {
      if (e.target === el.settingsModal) el.settingsModal.hidden = true;
    });

    el.maxTokensRange.addEventListener("input", () => {
      el.maxTokensValue.textContent = el.maxTokensRange.value;
    });
    el.temperatureRange.addEventListener("input", () => {
      el.temperatureValue.textContent = Number(el.temperatureRange.value).toFixed(1);
    });

    el.resetSettingsBtn.addEventListener("click", () => {
      state.settings = { ...state.defaults };
      syncSettingsUI();
    });

    el.saveSettingsBtn.addEventListener("click", () => {
      state.settings = {
        max_tokens: Number(el.maxTokensRange.value),
        temperature: Number(el.temperatureRange.value),
        system_prompt: el.systemPromptInput.value.trim() || state.defaults.system_prompt,
      };
      persistSettings();
      syncSettingsUI();
      el.settingsModal.hidden = true;
    });

    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        createNewChat(true);
      } else if (e.key === "Escape") {
        el.settingsModal.hidden = true;
        closeMobileSidebar();
      }
    });
  }

  async function init() {
    loadStorage();
    syncSettingsUI();
    renderSidebar();
    renderActiveChat();
    updateComposerState();
    bindEvents();
    await checkHealth();
  }

  init();
})();
