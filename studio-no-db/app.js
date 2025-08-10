(function () {
  const APP_STORAGE_KEY = "studio_no_db_state_v1";

  function generateId() {
    const random = Math.random().toString(16).slice(2);
    const time = Date.now().toString(16);
    return `${time}-${random}`;
  }

  function debounce(fn, ms) {
    let handle = null;
    return (...args) => {
      clearTimeout(handle);
      handle = setTimeout(() => fn(...args), ms);
    };
  }

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") el.className = value;
      else if (key === "style") Object.assign(el.style, value);
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2).toLowerCase(), value);
      else if (value === true) el.setAttribute(key, "");
      else if (value !== false && value != null) el.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child == null) continue;
      if (child instanceof Node) el.appendChild(child);
      else el.appendChild(document.createTextNode(String(child)));
    }
    return el;
  }

  function formatDate(date) {
    const d = new Date(date);
    return isNaN(d.getTime()) ? "" : d.toLocaleString();
  }

  const defaultState = {
    theme: "dark",
    schemas: [
      {
        name: "Post",
        type: "post",
        fields: [
          { name: "Title", key: "title", kind: "string", required: true },
          { name: "Slug", key: "slug", kind: "string", required: true },
          { name: "Body", key: "body", kind: "text" },
          { name: "Published", key: "published", kind: "boolean" },
          { name: "Tags (comma separated)", key: "tags", kind: "string" },
        ],
      },
    ],
    documents: {}, // { [type]: Array<Doc> }
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(APP_STORAGE_KEY);
      if (!raw) return JSON.parse(JSON.stringify(defaultState));
      const parsed = JSON.parse(raw);
      if (!parsed.documents) parsed.documents = {};
      return parsed;
    } catch (e) {
      console.warn("Failed to load state, using defaults", e);
      return JSON.parse(JSON.stringify(defaultState));
    }
  }

  const state = loadState();
  const saveState = debounce(() => {
    try {
      localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("Failed to save state", e);
    }
  }, 150);

  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    saveState();
  }
  document.documentElement.setAttribute("data-theme", state.theme || "dark");

  function getSchemaByType(type) {
    return state.schemas.find((s) => s.type === type);
  }

  function listDocuments(type) {
    return state.documents[type] || [];
  }

  function upsertDocument(type, doc) {
    if (!state.documents[type]) state.documents[type] = [];
    const idx = state.documents[type].findIndex((d) => d.id === doc.id);
    if (idx >= 0) state.documents[type][idx] = doc;
    else state.documents[type].unshift(doc);
    saveState();
  }

  function deleteDocument(type, id) {
    if (!state.documents[type]) return;
    state.documents[type] = state.documents[type].filter((d) => d.id !== id);
    saveState();
  }

  function upsertSchema(schema) {
    const existsIdx = state.schemas.findIndex((s) => s.type === schema.type);
    if (existsIdx >= 0) state.schemas[existsIdx] = schema;
    else state.schemas.push(schema);
    saveState();
  }

  function deleteSchema(type) {
    const idx = state.schemas.findIndex((s) => s.type === type);
    if (idx < 0) return;
    state.schemas.splice(idx, 1);
    delete state.documents[type];
    saveState();
  }

  function buildLeftPanel(route) {
    const container = h("aside", { class: "panel left" });
    container.appendChild(h("div", { class: "panel-title" }, "Content Types"));

    const listEl = h("ul", { class: "list" });
    for (const schema of state.schemas) {
      const link = h(
        "a",
        {
          href: `#/content/${schema.type}`,
          class: "btn ghost",
        },
        `${schema.name}`
      );
      const item = h("li", { class: "list-item" }, link, h("span", { class: "badge" }, (state.documents[schema.type] || []).length));
      listEl.appendChild(item);
    }
    container.appendChild(listEl);

    const addTypeBtn = h("button", { class: "btn primary", onclick: () => openCreateTypeModal() }, "New Type");
    container.appendChild(h("div", { class: "hr" }));
    container.appendChild(addTypeBtn);
    return container;
  }

  function buildRightPanel(selectedDoc, schema) {
    const container = h("aside", { class: "panel right" });
    container.appendChild(h("div", { class: "panel-title" }, "Preview"));
    const preview = h("div", { class: "preview" });

    if (!selectedDoc || !schema) {
      preview.appendChild(h("div", { class: "muted" }, "Select or create a document to see a preview."));
    } else {
      preview.appendChild(h("h2", {}, selectedDoc.title || selectedDoc.name || "Untitled"));
      preview.appendChild(h("div", { class: "muted" }, `${schema.name} • Updated ${formatDate(selectedDoc.updatedAt)}`));
      const body = selectedDoc.body || selectedDoc.content || "";
      if (body) {
        const paragraphs = String(body).split(/\n\n+/).map((p) => h("p", {}, p));
        preview.appendChild(h("div", {}, paragraphs));
      }
      const meta = h("div", { style: { marginTop: "10px" } },
        h("span", { class: "badge" }, selectedDoc.published ? "Published" : "Draft"),
        " ",
        h("span", { class: "badge" }, selectedDoc.slug ? `/${selectedDoc.slug}` : "no-slug")
      );
      preview.appendChild(meta);
    }

    container.appendChild(preview);
    return container;
  }

  function buildContentMain(type) {
    const schema = type ? getSchemaByType(type) : state.schemas[0];
    const effectiveType = schema ? schema.type : undefined;

    const container = h("section", { class: "panel main" });

    if (!schema) {
      container.appendChild(h("div", { class: "muted" }, "No content types yet. Create one from the left panel."));
      return container;
    }

    const toolbar = h("div", { class: "toolbar" },
      h("div", { class: "panel-title" }, `${schema.name} Documents`),
      h("span", { class: "badge" }, effectiveType),
      h("div", { style: { flex: 1 } }),
      h("button", { class: "btn primary", onclick: () => openEditor(schema, null) }, "New Document")
    );
    container.appendChild(toolbar);

    const docs = listDocuments(effectiveType);
    const list = h("ul", { class: "list" });

    if (docs.length === 0) {
      list.appendChild(h("li", { class: "list-item" }, h("span", { class: "muted" }, "No documents. Create the first one.")));
    } else {
      for (const doc of docs) {
        const openBtn = h("button", { class: "btn ghost", onclick: () => openEditor(schema, doc) }, "Open");
        const delBtn = h("button", { class: "btn danger", onclick: () => { if (confirm("Delete this document?")) { deleteDocument(effectiveType, doc.id); render(); } } }, "Delete");
        const left = h("div", {},
          h("div", { style: { fontWeight: "600" } }, doc.title || doc.name || "Untitled"),
          h("div", { class: "meta" }, `${formatDate(doc.updatedAt)} • ${doc.published ? "Published" : "Draft"}`)
        );
        list.appendChild(h("li", { class: "list-item" }, left, h("div", { class: "toolbar" }, openBtn, delBtn)));
      }
    }

    container.appendChild(list);
    return container;
  }

  function openEditor(schema, doc) {
    const overlay = h("div", { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 100 } });
    const panel = h("div", { class: "panel", style: { width: "min(880px, 92vw)", maxHeight: "90vh", overflow: "auto" } });

    const isNew = !doc;
    const documentData = doc ? { ...doc } : { id: generateId(), createdAt: Date.now(), updatedAt: Date.now() };

    const form = h("form", { class: "form", onsubmit: (e) => e.preventDefault() });

    for (const field of schema.fields) {
      const fieldId = `f_${schema.type}_${field.key}`;
      let input;
      if (field.kind === "text") {
        input = h("textarea", { id: fieldId, name: field.key, placeholder: field.name });
      } else if (field.kind === "boolean") {
        input = h("input", { id: fieldId, type: "checkbox", name: field.key });
      } else if (field.kind === "number") {
        input = h("input", { id: fieldId, type: "number", step: "any", name: field.key, placeholder: field.name });
      } else if (field.kind === "date") {
        input = h("input", { id: fieldId, type: "date", name: field.key });
      } else {
        input = h("input", { id: fieldId, type: "text", name: field.key, placeholder: field.name });
      }

      const value = documentData[field.key];
      if (field.kind === "boolean") input.checked = Boolean(value);
      else if (field.kind === "date" && value) input.valueAsDate = new Date(value);
      else if (value != null) input.value = value;

      const label = h("label", { for: fieldId }, field.name, field.required ? " *" : "");
      form.appendChild(h("div", { class: "field" }, label, input));
    }

    const actions = h("div", { class: "toolbar" },
      h("button", { class: "btn", onclick: () => document.body.removeChild(overlay) }, "Close"),
      h("div", { style: { flex: 1 } }),
      h("button", { class: "btn ghost", onclick: () => { navigator.clipboard.writeText(JSON.stringify(documentData, null, 2)); alert("Copied JSON to clipboard."); } }, "Copy JSON"),
      h("button", { class: "btn primary", onclick: () => {
        const formData = new FormData(form);
        for (const field of schema.fields) {
          const raw = formData.get(field.key);
          if (field.kind === "boolean") documentData[field.key] = document.getElementById(`f_${schema.type}_${field.key}`).checked;
          else if (field.kind === "number") documentData[field.key] = raw ? Number(raw) : null;
          else if (field.kind === "date") documentData[field.key] = raw ? new Date(String(raw)).toISOString() : null;
          else documentData[field.key] = raw ? String(raw) : "";
          if (field.required && !documentData[field.key]) {
            alert(`Missing required field: ${field.name}`);
            return;
          }
        }
        documentData.updatedAt = Date.now();
        upsertDocument(schema.type, documentData);
        document.body.removeChild(overlay);
        render();
      } }, isNew ? "Create" : "Save")
    );

    panel.appendChild(h("div", { class: "panel-title" }, isNew ? `New ${schema.name}` : `Edit ${schema.name}`));
    panel.appendChild(form);
    panel.appendChild(h("div", { class: "hr" }));
    panel.appendChild(actions);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) document.body.removeChild(overlay); });
    document.body.appendChild(overlay).appendChild(panel);
  }

  function buildSchemasMain() {
    const container = h("section", { class: "panel main" });
    container.appendChild(h("div", { class: "panel-title" }, "Schemas"));

    const list = h("ul", { class: "list" });
    for (const schema of state.schemas) {
      const editBtn = h("button", { class: "btn ghost", onclick: () => openSchemaEditor(schema) }, "Edit");
      const delBtn = h("button", { class: "btn danger", onclick: () => { if (confirm("Delete this type and all its documents?")) { deleteSchema(schema.type); render("#/schemas"); } } }, "Delete");
      list.appendChild(
        h("li", { class: "list-item" },
          h("div", {}, h("div", { style: { fontWeight: "600" } }, schema.name), h("div", { class: "meta" }, `${schema.type} • ${schema.fields.length} fields`)),
          h("div", { class: "toolbar" }, editBtn, delBtn)
        )
      );
    }
    container.appendChild(list);

    const addBtn = h("button", { class: "btn primary", onclick: () => openCreateTypeModal() }, "New Type");
    container.appendChild(h("div", { class: "hr" }));
    container.appendChild(addBtn);

    return container;
  }

  function openCreateTypeModal() {
    const overlay = h("div", { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 100 } });
    const panel = h("div", { class: "panel", style: { width: "min(560px, 92vw)" } });

    const form = h("form", { class: "form", onsubmit: (e) => e.preventDefault() });
    const nameInput = h("input", { type: "text", placeholder: "Display name (e.g., Product)", required: true });
    const typeInput = h("input", { type: "text", placeholder: "Type id (e.g., product)", required: true, pattern: "[a-z0-9_-]+" });

    form.appendChild(h("div", { class: "field" }, h("label", {}, "Name"), nameInput));
    form.appendChild(h("div", { class: "field" }, h("label", {}, "Type"), typeInput));

    const actions = h("div", { class: "toolbar" },
      h("button", { class: "btn", onclick: () => document.body.removeChild(overlay) }, "Cancel"),
      h("div", { style: { flex: 1 } }),
      h("button", { class: "btn primary", onclick: () => {
        const name = nameInput.value.trim();
        const type = typeInput.value.trim();
        if (!name || !type) return alert("Fill in name and type");
        if (getSchemaByType(type)) return alert("Type already exists");
        upsertSchema({ name, type, fields: [] });
        document.body.removeChild(overlay);
        openSchemaEditor(getSchemaByType(type));
      } }, "Create")
    );

    panel.appendChild(h("div", { class: "panel-title" }, "Create Type"));
    panel.appendChild(form);
    panel.appendChild(h("div", { class: "hr" }));
    panel.appendChild(actions);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) document.body.removeChild(overlay); });
    document.body.appendChild(overlay).appendChild(panel);
  }

  function openSchemaEditor(schema) {
    const overlay = h("div", { style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 100 } });
    const panel = h("div", { class: "panel", style: { width: "min(880px, 92vw)", maxHeight: "90vh", overflow: "auto" } });

    const form = h("form", { class: "form", onsubmit: (e) => e.preventDefault() });

    const nameInput = h("input", { type: "text", value: schema.name });
    const typeInput = h("input", { type: "text", value: schema.type, disabled: true });
    form.appendChild(h("div", { class: "field" }, h("label", {}, "Name"), nameInput));
    form.appendChild(h("div", { class: "field" }, h("label", {}, "Type"), typeInput));

    const fieldsList = h("div", { class: "form" });
    function renderFields() {
      fieldsList.innerHTML = "";
      schema.fields.forEach((field, index) => {
        const name = h("input", { type: "text", value: field.name, placeholder: "Field label" });
        const key = h("input", { type: "text", value: field.key, placeholder: "field_key" });
        const kind = h("select", {},
          h("option", { value: "string", selected: field.kind === "string" }, "string"),
          h("option", { value: "text", selected: field.kind === "text" }, "text"),
          h("option", { value: "number", selected: field.kind === "number" }, "number"),
          h("option", { value: "boolean", selected: field.kind === "boolean" }, "boolean"),
          h("option", { value: "date", selected: field.kind === "date" }, "date"),
        );
        const required = h("input", { type: "checkbox", checked: !!field.required });
        const remove = h("button", { class: "btn danger", onclick: () => { schema.fields.splice(index, 1); renderFields(); } }, "Remove");

        const row = h("div", { class: "list-item" },
          h("div", { class: "form", style: { width: "100%" } },
            h("div", { class: "field" }, h("label", {}, "Name"), name),
            h("div", { class: "field" }, h("label", {}, "Key"), key),
            h("div", { class: "field" }, h("label", {}, "Kind"), kind),
            h("div", { class: "field" }, h("label", {}, "Required"), required),
          ),
          remove
        );
        fieldsList.appendChild(row);

        function sync() {
          field.name = name.value.trim();
          field.key = key.value.trim();
          field.kind = kind.value;
          field.required = required.checked;
        }
        name.addEventListener("input", sync);
        key.addEventListener("input", sync);
        kind.addEventListener("change", sync);
        required.addEventListener("change", sync);
      });
    }
    renderFields();

    const addFieldBtn = h("button", { class: "btn ghost", onclick: () => { schema.fields.push({ name: "New Field", key: `field_${schema.fields.length + 1}`.toLowerCase(), kind: "string", required: false }); renderFields(); } }, "Add Field");

    const actions = h("div", { class: "toolbar" },
      h("button", { class: "btn", onclick: () => document.body.removeChild(overlay) }, "Close"),
      h("div", { style: { flex: 1 } }),
      h("button", { class: "btn primary", onclick: () => {
        schema.name = nameInput.value.trim() || schema.name;
        // validate fields
        const keys = new Set();
        for (const f of schema.fields) {
          if (!f.name || !f.key) return alert("All fields must have name and key");
          if (keys.has(f.key)) return alert(`Duplicate field key: ${f.key}`);
          keys.add(f.key);
        }
        upsertSchema(schema);
        document.body.removeChild(overlay);
        render("#/schemas");
      } }, "Save")
    );

    panel.appendChild(h("div", { class: "panel-title" }, `Edit Type: ${schema.type}`));
    panel.appendChild(form);
    panel.appendChild(h("div", { class: "hr" }));
    panel.appendChild(h("div", { class: "panel-title" }, "Fields"));
    panel.appendChild(fieldsList);
    panel.appendChild(h("div", { class: "hr" }));
    panel.appendChild(addFieldBtn);
    panel.appendChild(h("div", { class: "hr" }));
    panel.appendChild(actions);

    overlay.addEventListener("click", (e) => { if (e.target === overlay) document.body.removeChild(overlay); });
    document.body.appendChild(overlay).appendChild(panel);
  }

  function buildExportMain() {
    const container = h("section", { class: "panel main" });
    container.appendChild(h("div", { class: "panel-title" }, "Export / Import"));

    const text = h("textarea", { placeholder: "State JSON will appear here" });
    text.value = JSON.stringify(state, null, 2);

    const info = h("div", { class: "muted" }, "Copy this JSON as a backup, or paste to import. Import replaces the current state.");

    const actions = h("div", { class: "toolbar" },
      h("button", { class: "btn ghost", onclick: () => { text.value = JSON.stringify(state, null, 2); } }, "Refresh"),
      h("button", { class: "btn", onclick: async () => { await navigator.clipboard.writeText(text.value); alert("Copied to clipboard"); } }, "Copy"),
      h("div", { style: { flex: 1 } }),
      h("button", { class: "btn primary", onclick: () => {
        try {
          const imported = JSON.parse(text.value);
          localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(imported));
          location.reload();
        } catch (e) {
          alert("Invalid JSON");
        }
      } }, "Import (Replace)")
    );

    container.appendChild(text);
    container.appendChild(h("div", { class: "hr" }));
    container.appendChild(info);
    container.appendChild(h("div", { class: "hr" }));
    container.appendChild(actions);
    return container;
  }

  function buildRoute(route) {
    const [_, page, type] = (route || location.hash || "#/content").split("/");

    const left = buildLeftPanel(route);
    let main;
    if (page === "schemas") main = buildSchemasMain();
    else if (page === "export") main = buildExportMain();
    else main = buildContentMain(type);

    const docs = page === "content" ? listDocuments(type || (state.schemas[0] && state.schemas[0].type)) : [];
    const selectedDoc = docs[0];
    const schema = type ? getSchemaByType(type) : state.schemas[0];
    const right = buildRightPanel(selectedDoc, schema);

    return [left, main, right];
  }

  function render(route) {
    if (route) location.hash = route;

    const app = document.getElementById("app");
    app.innerHTML = "";
    const [left, main, right] = buildRoute(route);
    app.appendChild(left);
    app.appendChild(main);
    app.appendChild(right);

    document.querySelectorAll(".nav-link").forEach((a) => {
      const href = a.getAttribute("href");
      a.classList.toggle("active", href === (location.hash || "#/content"));
    });
  }

  window.addEventListener("hashchange", () => render());

  document.getElementById("themeToggle").addEventListener("click", () => {
    const next = (state.theme === "dark") ? "light" : "dark";
    setTheme(next);
  });

  document.getElementById("resetApp").addEventListener("click", () => {
    if (!confirm("This will delete all local data. Continue?")) return;
    localStorage.removeItem(APP_STORAGE_KEY);
    location.reload();
  });

  render();
})();