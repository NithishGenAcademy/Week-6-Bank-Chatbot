(() => {
  const API_KEY_STORAGE_KEY = "neobank-aria:openai-api-key";
  const RESPONSE_STORAGE_PREFIX = "neobank-aria:response:";
  const FRAME_HEIGHT_PADDING = 12;
  const root = document.getElementById("root") || document.body;
  const state = {
    lastHasKey: null,
    lastApiKey: null,
    pendingRequests: new Map(),
    resizeObserver: null,
  };

  function postMessage(type, data = {}) {
    window.parent.postMessage(
      {
        isStreamlitMessage: true,
        type,
        ...data,
      },
      "*"
    );
  }

  function setComponentValue(value) {
    postMessage("streamlit:setComponentValue", { value });
  }

  function setFrameHeight(height) {
    const hasExplicitHeight = typeof height === "number";
    const measuredHeight = hasExplicitHeight
      ? Math.ceil(height)
      : Math.ceil(
          root.scrollHeight ||
            document.body.scrollHeight ||
            document.documentElement.scrollHeight ||
            1
        ) + FRAME_HEIGHT_PADDING;

    postMessage("streamlit:setFrameHeight", {
      height: Math.max(measuredHeight, 1),
    });
  }

  function startHeightObserver() {
    if (state.resizeObserver || !window.ResizeObserver) {
      return;
    }

    state.resizeObserver = new ResizeObserver(() => setFrameHeight());
    state.resizeObserver.observe(root);
  }

  function setReady() {
    postMessage("streamlit:componentReady", { apiVersion: 1 });
  }

  function readStoredValue() {
    try {
      return window.localStorage.getItem(API_KEY_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }

  function writeStoredValue(value) {
    try {
      if (value) {
        window.localStorage.setItem(API_KEY_STORAGE_KEY, value);
      } else {
        window.localStorage.removeItem(API_KEY_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures; the app will simply behave as if no key was saved.
    }
  }

  function looksLikeApiKey(value) {
    return value.startsWith("sk-") && value.length >= 40;
  }

  function readCachedResponse(requestId) {
    try {
      const raw = window.localStorage.getItem(`${RESPONSE_STORAGE_PREFIX}${requestId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function cacheResponse(requestId, payload) {
    try {
      window.localStorage.setItem(
        `${RESPONSE_STORAGE_PREFIX}${requestId}`,
        JSON.stringify(payload)
      );
    } catch {
      // Ignore cache failures.
    }
  }

  function reportKeyState(value) {
    const hasKey = looksLikeApiKey(value);
    const apiKey = hasKey ? value : "";
    if (state.lastHasKey === hasKey && state.lastApiKey === apiKey) {
      return;
    }
    state.lastHasKey = hasKey;
    state.lastApiKey = apiKey;
    setComponentValue({
      has_key: hasKey,
      api_key: apiKey,
    });
  }

  function clearRoot() {
    root.innerHTML = "";
  }

  function renderKeyMode(
    args,
    announceInitialState = true,
    updateFrameHeight = true
  ) {
    clearRoot();

    const wrapper = document.createElement("div");
    wrapper.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    wrapper.style.fontSize = "14px";
    wrapper.style.color = "#e6e6e6";
    wrapper.style.paddingBottom = "0.25rem";

    const label = document.createElement("div");
    label.textContent = args.label || "OpenAI API Key";
    label.style.fontSize = "13px";
    label.style.fontWeight = "600";
    label.style.marginBottom = "0.35rem";

    const input = document.createElement("input");
    input.type = "password";
    input.placeholder = args.placeholder || "sk-...";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.style.width = "100%";
    input.style.boxSizing = "border-box";
    input.style.border = "1px solid rgba(255,255,255,0.18)";
    input.style.borderRadius = "0.5rem";
    input.style.background = "rgba(255,255,255,0.04)";
    input.style.color = "#fff";
    input.style.padding = "0.55rem 0.7rem";
    input.style.outline = "none";
    input.value = readStoredValue();

    const help = document.createElement("div");
    help.textContent = args.help_text || "Enter your OpenAI API key. It stays in this browser session only.";
    help.style.marginTop = "0.4rem";
    help.style.fontSize = "11px";
    help.style.lineHeight = "1.35";
    help.style.color = "rgba(230,230,230,0.7)";

    const status = document.createElement("div");
    status.style.marginTop = "0.4rem";
    status.style.fontSize = "11px";
    status.style.color = "rgba(148, 163, 184, 0.95)";

    function syncState(nextValue) {
      writeStoredValue(nextValue);
      const hasKey = looksLikeApiKey(nextValue);
      status.textContent = hasKey
        ? "Saved locally in this browser."
        : nextValue
          ? "Paste the complete key to enable chat."
          : "";
      status.style.display = status.textContent ? "block" : "none";
      reportKeyState(nextValue);
      setFrameHeight();
    }

    input.addEventListener("input", () => syncState(input.value.trim()));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        syncState(input.value.trim());
      }
    });

    const savedValue = readStoredValue();
    status.textContent = looksLikeApiKey(savedValue)
      ? "Saved locally in this browser."
      : savedValue
        ? "Paste the complete key to enable chat."
        : "";
    status.style.display = status.textContent ? "block" : "none";

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    wrapper.appendChild(help);
    wrapper.appendChild(status);
    root.appendChild(wrapper);

    if (announceInitialState && looksLikeApiKey(savedValue)) {
      reportKeyState(savedValue);
    }
    if (updateFrameHeight) {
      setFrameHeight();
    }
  }

  async function fetchAssistantResponse(args, requestId) {
    const apiKey = readStoredValue();
    if (!looksLikeApiKey(apiKey)) {
      const payload = {
        request_id: requestId,
        response: "",
        error: "Please enter your OpenAI API key in the sidebar to start chatting.",
      };
      cacheResponse(requestId, payload);
      setComponentValue(payload);
      return;
    }

    const messages = [];
    if (typeof args.system_prompt === "string" && args.system_prompt) {
      messages.push({ role: "system", content: args.system_prompt });
    }

    if (Array.isArray(args.chat_history)) {
      for (const message of args.chat_history) {
        if (
          message &&
          typeof message.role === "string" &&
          typeof message.content === "string"
        ) {
          messages.push({ role: message.role, content: message.content });
        }
      }
    }

    if (typeof args.user_message === "string" && args.user_message) {
      messages.push({ role: "user", content: args.user_message });
    }

    const requestBody = {
      model: args.model || "gpt-3.5-turbo",
      temperature: typeof args.temperature === "number" ? args.temperature : 0.3,
      max_tokens: typeof args.max_tokens === "number" ? args.max_tokens : 2048,
      messages,
    };

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || `OpenAI request failed with HTTP ${response.status}`);
    }

    return data?.choices?.[0]?.message?.content || "";
  }

  function renderChatMode(args) {
    clearRoot();

    const requestId = String(args.request_id || "");
    if (!requestId) {
      setFrameHeight(1);
      return;
    }

    const cached = readCachedResponse(requestId);
    if (cached) {
      setComponentValue(cached);
      setFrameHeight(1);
      return;
    }

    if (state.pendingRequests.has(requestId)) {
      setFrameHeight(1);
      return;
    }

    const status = document.createElement("div");
    status.textContent = "ARIA is thinking...";
    status.style.display = "none";
    root.appendChild(status);
    setFrameHeight(1);

    const pending = fetchAssistantResponse(args, requestId)
      .then((responseText) => {
        const payload = {
          request_id: requestId,
          response: responseText,
          error: null,
        };
        cacheResponse(requestId, payload);
        setComponentValue(payload);
      })
      .catch((error) => {
        const payload = {
          request_id: requestId,
          response: "",
          error: error instanceof Error ? error.message : String(error),
        };
        cacheResponse(requestId, payload);
        setComponentValue(payload);
      })
      .finally(() => {
        state.pendingRequests.delete(requestId);
      });

    state.pendingRequests.set(requestId, pending);
  }

  function renderComponent(args) {
    if (args.mode === "chat") {
      renderChatMode(args);
      return;
    }

    if (args.mode === "key") {
      renderKeyMode(args);
      return;
    }

    clearRoot();
    setFrameHeight(1);
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || !data.isStreamlitMessage || data.type !== "streamlit:render") {
      return;
    }

    renderComponent(data.args || {});
  });

  function boot() {
    renderKeyMode(
      {
        label: "OpenAI API Key",
        placeholder: "sk-...",
        help_text: "Enter your OpenAI API key. It stays in this browser session only.",
      },
      false,
      false
    );

    setTimeout(() => {
      setReady();
      startHeightObserver();
      setFrameHeight();
    }, 0);
  }

  if (document.readyState === "loading") {
    window.addEventListener("load", boot, { once: true });
  } else {
    boot();
  }
})();
