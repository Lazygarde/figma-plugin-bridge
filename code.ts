// Main thread of the "Design Live Bridge" plugin.
//
// Flow: AI agent -> (MCP / HTTP) -> bridge server -> WebSocket -> ui.html -> postMessage -> this file.
// This file has access to `figma.*` but NOT to the network, so the UI iframe owns the WebSocket
// and forwards every command here as { type: 'command', reqId, cmd, args }.

figma.showUI(__html__, { width: 320, height: 240, title: 'Design Live Bridge' });

type Args = Record<string, unknown>;

interface CommandMessage {
  type: 'command';
  reqId: string;
  cmd: string;
  args?: Args;
}

interface ThinNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  childCount?: number;
  children?: ThinNode[];
}

// ---------- helpers ----------

/** With documentAccess "dynamic-page", nodes on other pages must be loaded before use. */
async function ensurePageLoaded(node: BaseNode): Promise<void> {
  let cur: BaseNode | null = node;
  while (cur && cur.type !== 'PAGE' && cur.type !== 'DOCUMENT') cur = cur.parent;
  if (cur && cur.type === 'PAGE') await cur.loadAsync();
}

/** Resolve a target node: explicit id > first selected node > current page. */
async function resolveNode(args: Args | undefined): Promise<BaseNode> {
  const id = args && typeof args.id === 'string' ? args.id : undefined;
  if (id) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node) throw new Error(`Node not found: ${id}`);
    await ensurePageLoaded(node);
    return node;
  }
  const sel = figma.currentPage.selection;
  if (sel.length > 0) return sel[0];
  return figma.currentPage;
}

function numArg(args: Args | undefined, key: string, fallback: number): number {
  const v = args ? args[key] : undefined;
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

function thin(node: BaseNode, depth: number): ThinNode {
  const out: ThinNode = { id: node.id, name: node.name, type: node.type };
  if ('visible' in node) out.visible = node.visible;
  if ('x' in node) {
    out.x = Math.round(node.x * 100) / 100;
    out.y = Math.round(node.y * 100) / 100;
  }
  if ('width' in node) {
    out.width = Math.round(node.width * 100) / 100;
    out.height = Math.round(node.height * 100) / 100;
  }
  if ('children' in node) {
    out.childCount = node.children.length;
    if (depth > 0) out.children = node.children.map((c) => thin(c, depth - 1));
  }
  return out;
}

/** Truncate a REST-style JSON tree to `depth` levels of children to keep payloads small. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pruneDepth(json: any, depth: number): any {
  if (!json || typeof json !== 'object') return json;
  if (Array.isArray(json.children)) {
    if (depth <= 0) {
      json.childCount = json.children.length;
      delete json.children;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      json.children = json.children.map((c: any) => pruneDepth(c, depth - 1));
    }
  }
  return json;
}

// ---------- variables (VariableID -> token name) ----------

interface ResolvedVariable {
  name: string;
  collection: string;
  type: string;
  remote: boolean;
  codeSyntax?: Record<string, string | undefined>;
  valuesByMode: Record<string, unknown>;
}
type VarLookup = ResolvedVariable | { unresolved: true };

const varCache = new Map<string, VarLookup>();

function toHex(c: { r: number; g: number; b: number; a?: number }): string {
  const h = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0').toUpperCase();
  const a = c.a === undefined || c.a >= 1 ? '' : h(c.a);
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${a}`;
}

/** Make a variable value readable: colors -> hex, aliases -> { alias: "token/name" }. */
async function formatVarValue(v: VariableValue): Promise<unknown> {
  if (typeof v === 'object' && v !== null) {
    if ('type' in v && v.type === 'VARIABLE_ALIAS') {
      const target = await figma.variables.getVariableByIdAsync(v.id);
      return { alias: target ? target.name : v.id };
    }
    if ('r' in v && 'g' in v && 'b' in v) return toHex(v as RGBA);
  }
  return v;
}

async function resolveVariableId(id: string): Promise<VarLookup> {
  const cached = varCache.get(id);
  if (cached) return cached;
  let out: VarLookup = { unresolved: true };
  try {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (v) {
      const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
      const modeName = new Map((col ? col.modes : []).map((m) => [m.modeId, m.name]));
      const valuesByMode: Record<string, unknown> = {};
      for (const [modeId, val] of Object.entries(v.valuesByMode)) {
        valuesByMode[modeName.get(modeId) ?? modeId] = await formatVarValue(val);
      }
      out = {
        name: v.name,
        collection: col ? col.name : '',
        type: v.resolvedType,
        remote: v.remote,
        codeSyntax: v.codeSyntax as Record<string, string | undefined>,
        valuesByMode,
      };
    }
  } catch (_e) {
    // keep unresolved
  }
  varCache.set(id, out);
  return out;
}

/** Collect every VARIABLE_ALIAS object in a JSON tree. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectAliases(json: any, acc: any[] = []): any[] {
  if (Array.isArray(json)) {
    for (const x of json) collectAliases(x, acc);
  } else if (json && typeof json === 'object') {
    if (json.type === 'VARIABLE_ALIAS' && typeof json.id === 'string') acc.push(json);
    for (const k of Object.keys(json)) collectAliases(json[k], acc);
  }
  return acc;
}

/** Annotate aliases in-place with `name` and return a top-level { id: ResolvedVariable } map. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function annotateVariables(json: any): Promise<Record<string, VarLookup>> {
  const aliases = collectAliases(json);
  const map: Record<string, VarLookup> = {};
  for (const a of aliases) {
    if (!(a.id in map)) map[a.id] = await resolveVariableId(a.id);
    const r = map[a.id];
    if ('name' in r) a.name = r.name;
  }
  return map;
}

// ---------- image fills (imageRef -> raw bytes) ----------

interface ImageUse {
  imageRef: string;
  nodeId: string;
  nodeName: string;
  where: 'fills' | 'strokes';
  paintIndex: number;
  visible: boolean;
  opacity: number;
  blendMode: string;
  scaleMode: string;
  imageTransform?: Transform;
  scalingFactor?: number;
  rotation?: number;
}

const MAX_WALK = 5000;

function collectImageUses(root: BaseNode): ImageUse[] {
  const uses: ImageUse[] = [];
  let visited = 0;
  const walk = (n: BaseNode) => {
    if (++visited > MAX_WALK) return;
    for (const where of ['fills', 'strokes'] as const) {
      if (!(where in n)) continue;
      const paints = (n as GeometryMixin)[where];
      if (!Array.isArray(paints)) continue; // figma.mixed on text
      paints.forEach((p: Paint, i: number) => {
        if (p.type === 'IMAGE' && p.imageHash) {
          uses.push({
            imageRef: p.imageHash,
            nodeId: n.id,
            nodeName: n.name,
            where,
            paintIndex: i,
            visible: p.visible !== false,
            opacity: p.opacity ?? 1,
            blendMode: p.blendMode ?? 'NORMAL',
            scaleMode: p.scaleMode,
            imageTransform: p.imageTransform,
            scalingFactor: p.scalingFactor,
            rotation: p.rotation,
          });
        }
      });
    }
    if ('children' in n) for (const c of n.children) walk(c);
  };
  walk(root);
  return uses;
}

function sniffImage(b: Uint8Array): { ext: string; mime: string } {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { ext: 'gif', mime: 'image/gif' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return { ext: 'bin', mime: 'application/octet-stream' };
}

// ---------- commands ----------

interface CommandResult {
  data?: unknown;
  bytes?: Uint8Array;
  mime?: string;
  /** Several binary outputs (e.g. image fills). */
  files?: { name: string; bytes: Uint8Array; mime: string }[];
}

const commands: Record<string, (args: Args | undefined) => Promise<CommandResult>> = {
  async ping() {
    return {
      data: {
        fileName: figma.root.name,
        page: figma.currentPage.name,
        pageId: figma.currentPage.id,
        selectionCount: figma.currentPage.selection.length,
        editorType: figma.editorType,
      },
    };
  },

  async get_selection() {
    return { data: figma.currentPage.selection.map((n) => thin(n, 0)) };
  },

  async get_pages() {
    return { data: figma.root.children.map((p) => ({ id: p.id, name: p.name, childCount: p.children.length })) };
  },

  /** Thin layer tree (id/name/type/bounds). Cheap way for an agent to browse before fetching details. */
  async get_metadata(args) {
    const node = await resolveNode(args);
    return { data: thin(node, numArg(args, 'depth', 2)) };
  },

  /** Full node properties (REST-compatible JSON: fills, effects, text style, auto layout, constraints...). */
  async get_node(args) {
    const node = await resolveNode(args);
    if (node.type === 'PAGE' || node.type === 'DOCUMENT') {
      throw new Error('get_node needs a frame/component node id. Use get_metadata to browse pages.');
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await (node as SceneNode).exportAsync({ format: 'JSON_REST_V1' });
    const depth = numArg(args, 'depth', 10);
    if (json && json.document) json.document = pruneDepth(json.document, depth);
    // Default on: every VARIABLE_ALIAS gets a `name`, and a top-level `variables` map holds token details.
    if (!args || args.resolveVariables !== false) json.variables = await annotateVariables(json);
    return { data: json };
  },

  /** Turn VariableIDs into token name, collection, type, per-mode values and Android code syntax. */
  async resolve_variables(args) {
    const ids = args && Array.isArray(args.ids) ? args.ids.filter((x): x is string => typeof x === 'string') : [];
    if (ids.length === 0) throw new Error('ids (string[]) is required');
    const out: Record<string, VarLookup> = {};
    for (const id of ids) out[id] = await resolveVariableId(id);
    return { data: out };
  },

  /** Find image fills/strokes (imageRef) in a subtree, with the transform/blend info needed to reproduce them. */
  async list_image_fills(args) {
    const root = await resolveNode(args);
    const uses = collectImageUses(root);
    const byRef = new Map<string, ImageUse[]>();
    for (const u of uses) byRef.set(u.imageRef, [...(byRef.get(u.imageRef) ?? []), u]);
    const images = [];
    for (const [imageRef, usedBy] of byRef) {
      const img = figma.getImageByHash(imageRef);
      const size = img ? await img.getSizeAsync() : null;
      images.push({ imageRef, width: size?.width, height: size?.height, usedBy });
    }
    return { data: { root: { id: root.id, name: root.name }, images } };
  },

  /** Raw original bytes of image fills. Pass `imageRef` for one image, or `id` for all images under a node. */
  async export_image_fills(args) {
    let refs: string[];
    let usedBy: ImageUse[] = [];
    if (args && typeof args.imageRef === 'string') {
      refs = [args.imageRef];
    } else {
      const root = await resolveNode(args);
      usedBy = collectImageUses(root);
      refs = [...new Set(usedBy.map((u) => u.imageRef))];
    }
    const files: { name: string; bytes: Uint8Array; mime: string }[] = [];
    const images = [];
    for (const imageRef of refs) {
      const img = figma.getImageByHash(imageRef);
      if (!img) {
        images.push({ imageRef, error: 'image not found in this file' });
        continue;
      }
      const bytes = await img.getBytesAsync();
      const size = await img.getSizeAsync();
      const { ext, mime } = sniffImage(bytes);
      const fileName = `fill_${imageRef.slice(0, 16)}.${ext}`;
      files.push({ name: fileName, bytes, mime });
      images.push({
        imageRef,
        fileName,
        mime,
        width: size.width,
        height: size.height,
        usedBy: usedBy.filter((u) => u.imageRef === imageRef),
      });
    }
    return { data: { images }, files };
  },

  /** PNG / JPG / SVG render of a node. Bytes are returned separately; the bridge saves them to disk. */
  async export_image(args) {
    const node = await resolveNode(args);
    if (node.type === 'PAGE' || node.type === 'DOCUMENT') throw new Error('export_image needs a scene node id.');
    const fmt = args && typeof args.format === 'string' ? args.format.toUpperCase() : 'PNG';
    const scale = numArg(args, 'scale', 2);
    let bytes: Uint8Array;
    let mime: string;
    if (fmt === 'SVG') {
      bytes = await (node as SceneNode).exportAsync({ format: 'SVG' });
      mime = 'image/svg+xml';
    } else if (fmt === 'JPG') {
      bytes = await (node as SceneNode).exportAsync({ format: 'JPG', constraint: { type: 'SCALE', value: scale } });
      mime = 'image/jpeg';
    } else {
      bytes = await (node as SceneNode).exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: scale } });
      mime = 'image/png';
    }
    return { data: { id: node.id, name: node.name, format: fmt, scale }, bytes, mime };
  },

  /** Local variable collections (color / spacing / typography tokens) with values per mode. */
  async get_variables() {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const variables = await figma.variables.getLocalVariablesAsync();
    return {
      data: collections.map((c) => ({
        id: c.id,
        name: c.name,
        modes: c.modes,
        variables: variables
          .filter((v) => v.variableCollectionId === c.id)
          .map((v) => ({
            id: v.id,
            name: v.name,
            type: v.resolvedType,
            scopes: v.scopes,
            valuesByMode: v.valuesByMode,
          })),
      })),
    };
  },

  /** Local paint / text / effect styles (e.g. drop shadows). */
  async get_styles() {
    const [paint, text, effect] = await Promise.all([
      figma.getLocalPaintStylesAsync(),
      figma.getLocalTextStylesAsync(),
      figma.getLocalEffectStylesAsync(),
    ]);
    return {
      data: {
        paint: paint.map((s) => ({ id: s.id, name: s.name, paints: s.paints })),
        text: text.map((s) => ({
          id: s.id,
          name: s.name,
          fontName: s.fontName,
          fontSize: s.fontSize,
          lineHeight: s.lineHeight,
          letterSpacing: s.letterSpacing,
          textCase: s.textCase,
          textDecoration: s.textDecoration,
        })),
        effect: effect.map((s) => ({ id: s.id, name: s.name, effects: s.effects })),
      },
    };
  },
};

// ---------- message plumbing ----------

figma.ui.onmessage = async (msg: CommandMessage | { type: 'close' }) => {
  if (msg.type === 'close') {
    figma.closePlugin();
    return;
  }
  if (msg.type !== 'command') return;

  const handler = commands[msg.cmd];
  if (!handler) {
    figma.ui.postMessage({ type: 'result', reqId: msg.reqId, ok: false, error: `Unknown command: ${msg.cmd}` });
    return;
  }
  try {
    varCache.clear(); // variable values can change between calls
    const res = await handler(msg.args);
    figma.ui.postMessage({
      type: 'result',
      reqId: msg.reqId,
      ok: true,
      data: res.data,
      bytes: res.bytes,
      mime: res.mime,
      files: res.files,
    });
  } catch (e) {
    figma.ui.postMessage({
      type: 'result',
      reqId: msg.reqId,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
};

// Let the UI show the current selection.
figma.on('selectionchange', () => {
  figma.ui.postMessage({
    type: 'selection',
    selection: figma.currentPage.selection.map((n) => thin(n, 0)),
  });
});
