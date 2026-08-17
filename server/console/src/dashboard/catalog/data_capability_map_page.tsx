import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Panel,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  DatabaseIcon,
  HashIcon,
  LayersIcon,
  MinusIcon,
  PlusIcon,
  ScanIcon,
  TagIcon,
  XIcon,
} from "lucide-react";
import type {
  DataCapabilityMapMetricDomain,
  DataCapabilityMapFact,
  DataCapabilityMapData,
  DataCapabilityMapDimensionGroup,
} from "@data-capability-map";
import { Button } from "@/components/ui/button";
import { ViewSidebar } from "@/components/ui/view-sidebar";
import { cn } from "@/lib/utils";
import { MAIN_CARD_BODY_INSET } from "../layout/layout_chrome";
import { errorText, useCapabilityMapQuery } from "../dashboard_queries";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  bindingGroupIncludes,
  capabilityColumns,
  capabilityEdges,
  groupedMemberNames,
  highlightFor,
  layoutCapabilities,
  memberCounts,
  nodeId,
  visibleEdges,
  type CapabilityNodeRef,
  type LaneKey,
} from "./data_capability_map";
import { SheetSection } from "../kit/sheet_kit";

const CapabilityMapContext = createContext<DataCapabilityMapData | null>(null);

function useCapabilityMapData(): DataCapabilityMapData {
  const data = useContext(CapabilityMapContext);
  if (!data) throw new Error("数据能力地图缺少运行时语义包上下文");
  return data;
}

function factsByName(data: DataCapabilityMapData): Map<string, DataCapabilityMapFact> {
  return new Map(data.facts.map((fact) => [fact.name, fact]));
}

/** 该事实被属性组认领的维度：呈现上归属左列属性组，不算作事实本体内容。 */
function groupedNamesOf(data: DataCapabilityMapData, fact: string): Set<string> {
  return groupedMemberNames(data.dimension_groups, fact);
}

const LANE_TITLES: Record<LaneKey, string> = {
  dimensions: "维度构件",
  metric_domains: "指标域",
  facts: "事实构件",
};

/** 层级引用成员名；无中文名时按原名展示。 */
function levelTitle(fact: DataCapabilityMapFact, level: string): string {
  const member = fact.members.find((candidate) => candidate.name === level);
  return member?.title ?? level;
}

const HANDLE_STYLE = {
  opacity: 0,
  pointerEvents: "none",
  width: 1,
  height: 1,
  minWidth: 1,
  minHeight: 1,
} as const;

type CapabilityNodeData = {
  ref: CapabilityNodeRef;
  dimmed: boolean;
  active: boolean;
};

type CapabilityFlowNode = Node<CapabilityNodeData, "capability">;
type LaneLabelFlowNode = Node<{ title: string; hub: boolean }, "lane_label">;

function nodeIcon(ref: CapabilityNodeRef): React.ReactElement {
  if (ref.kind === "metric_domain") return <LayersIcon />;
  if (ref.kind === "dimension_group") return <TagIcon />;
  return <DatabaseIcon />;
}

function nodeTitle(ref: CapabilityNodeRef): string {
  if (ref.kind === "fact") return ref.fact.title ?? ref.fact.name;
  if (ref.kind === "dimension_group") return ref.group.title ?? ref.group.name;
  return ref.topic.title;
}

/** 角色不进摘要（泳道标题已表达），只报内容量；全内部成员的构件按技术字段说明。 */
function nodeSummary(ref: CapabilityNodeRef, data: DataCapabilityMapData): string {
  if (ref.kind === "metric_domain") {
    return `${ref.topic.metrics.length} 个指标 · ${ref.topic.bindings.length} 个事实`;
  }
  if (ref.kind === "dimension_group") {
    return `${ref.group.members.length} 个分析维度`;
  }
  const counts = memberCounts(ref.fact, groupedNamesOf(data, ref.fact.name));
  const parts: string[] = [];
  if (counts.dimensions > 0) parts.push(`${counts.dimensions} 个分析维度`);
  if (counts.measures > 0) parts.push(`${counts.measures} 个指标`);
  return parts.length ? parts.join(" · ") : "仅技术字段";
}

function CapabilityNode({ data }: NodeProps<CapabilityFlowNode>) {
  const { ref } = data;
  const capabilityMap = useCapabilityMapData();
  return (
    <div
      className={cn(
        "cursor-pointer rounded-md border bg-pa-bg transition duration-150 hover:border-pa-ink",
        data.active && "border-pa-ink ring-1 ring-pa-ink",
        data.dimmed && "opacity-30",
      )}
      style={{ width: NODE_WIDTH }}
    >
      <Handle
        id="source-left"
        type="source"
        position={Position.Left}
        style={HANDLE_STYLE}
        isConnectable={false}
      />
      <Handle
        id="source-right"
        type="source"
        position={Position.Right}
        style={HANDLE_STYLE}
        isConnectable={false}
      />
      <Handle
        id="target-left"
        type="target"
        position={Position.Left}
        style={HANDLE_STYLE}
        isConnectable={false}
      />
      <Handle
        id="target-right"
        type="target"
        position={Position.Right}
        style={HANDLE_STYLE}
        isConnectable={false}
      />
      <header className="flex items-center gap-2 px-3 pt-2.5">
        <span className="shrink-0 text-pa-ink [&_svg]:size-4" aria-hidden="true">
          {nodeIcon(ref)}
        </span>
        <div className="min-w-0 flex-1 truncate font-medium text-sm">{nodeTitle(ref)}</div>
      </header>
      <div className="px-3 pt-1 pb-2.5 text-pa-muted text-xs">
        {nodeSummary(ref, capabilityMap)}
      </div>
    </div>
  );
}

/** 枢纽泳道（指标域）标题用前景色压重一档，其余泳道保持弱化。 */
function LaneLabelNode({ data }: NodeProps<LaneLabelFlowNode>) {
  return (
    <div
      className={cn("font-medium text-sm", data.hub ? "text-pa-fg" : "text-pa-muted")}
      style={{ width: NODE_WIDTH }}
    >
      {data.title}
    </div>
  );
}

type CapabilityEdgeData = { chip?: string };
type CapabilityFlowEdge = Edge<CapabilityEdgeData, "capability">;

function CapabilityEdge({
  id,
  data,
  markerEnd,
  sourcePosition,
  sourceX,
  sourceY,
  style,
  targetPosition,
  targetX,
  targetY,
}: EdgeProps<CapabilityFlowEdge>) {
  const [path, labelX, labelY] = getBezierPath({
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  });
  return (
    <>
      <BaseEdge id={id} markerEnd={markerEnd} path={path} style={style} />
      {data?.chip && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded-sm border bg-pa-bg px-1.5 py-0.5 text-2xs text-pa-muted leading-none"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {data.chip}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const NODE_TYPES = { capability: CapabilityNode, lane_label: LaneLabelNode };
const EDGE_TYPES = { capability: CapabilityEdge };

const PRO_OPTIONS = { hideAttribution: true };

/** 首屏取景与「回到全景」共用一份取景参数：两处各写一个数，回不到人记得的那一屏。 */
const MAP_FIT_VIEW = { padding: 0.1 };

type ListedMember = {
  name: string;
  label: string;
  mono: boolean;
  kind: "dimension" | "measure";
};

/**
 * 展平为可列举成员：不传 names 取主题全部公开成员；传 names（绑定 includes）时
 * 逐名解析——公开成员按类型归组，部门树归入维度组，未识别名原样保留（与边上计数守恒）。
 */
function listedMembers(fact: DataCapabilityMapFact, names?: string[]): ListedMember[] {
  if (!names) {
    return fact.members
      .filter((member) => !member.internal)
      .map((member) => ({
        name: member.name,
        label: member.title ?? member.name,
        mono: !member.title,
        kind: member.kind,
      }));
  }
  const listed: ListedMember[] = [];
  for (const name of names) {
    const member = fact.members.find((candidate) => candidate.name === name);
    if (member) {
      if (member.internal) continue;
      listed.push({
        name,
        label: member.title ?? member.name,
        mono: !member.title,
        kind: member.kind,
      });
      continue;
    }
    const hierarchy = fact.hierarchies.find((candidate) => candidate.name === name);
    listed.push({
      name,
      label: hierarchy?.title ?? name,
      mono: !hierarchy?.title,
      kind: "dimension",
    });
  }
  return listed;
}

function MemberRows({ members, kind }: { members: ListedMember[]; kind: ListedMember["kind"] }) {
  const group = members.filter((member) => member.kind === kind);
  if (!group.length) return null;
  return (
    <div className="flex flex-col">
      <div className="flex h-[26px] items-center font-medium text-pa-muted text-xs">
        {kind === "dimension" ? "分析维度" : "指标"}
      </div>
      {group.map((member) => (
        <div className="flex h-6 items-center gap-1.5 text-xs" key={member.name}>
          <span className="shrink-0 text-pa-ink [&_svg]:size-3" aria-hidden="true">
            {kind === "dimension" ? <TagIcon /> : <HashIcon />}
          </span>
          <span className={cn("truncate", member.mono && "font-mono")}>{member.label}</span>
        </div>
      ))}
    </div>
  );
}

function MemberListSection({
  title,
  fact,
  names,
}: {
  title: string;
  fact: DataCapabilityMapFact;
  names?: string[];
}) {
  const members = listedMembers(fact, names);
  if (!members.length) return null;
  return (
    <SheetSection title={title}>
      <MemberRows kind="dimension" members={members} />
      <MemberRows kind="measure" members={members} />
    </SheetSection>
  );
}

function FactInspectorBody({ fact }: { fact: DataCapabilityMapFact }) {
  const capabilityMap = useCapabilityMapData();
  // 被属性组认领的维度归属左列组节点，事实本体清单只列剩余内容。
  const grouped = groupedNamesOf(capabilityMap, fact.name);
  const ownNames = fact.members
    .filter((member) => !member.internal && !grouped.has(member.name))
    .map((member) => member.name);
  return (
    <>
      {fact.description && (
        <SheetSection>
          <p className="text-sm">{fact.description}</p>
        </SheetSection>
      )}
      <MemberListSection fact={fact} names={ownNames} title="内容清单" />
      {fact.hierarchies.length > 0 && (
        <SheetSection title="部门树">
          {fact.hierarchies.map((hierarchy) => (
            <p className="text-sm" key={hierarchy.name}>
              <span className="font-medium">{hierarchy.title ?? hierarchy.name}</span>
              <span className="ms-2 text-pa-muted text-xs">
                {hierarchy.levels.map((level) => levelTitle(fact, level)).join(" → ")}
              </span>
            </p>
          ))}
        </SheetSection>
      )}
    </>
  );
}

function DimensionGroupInspectorBody({ group }: { group: DataCapabilityMapDimensionGroup }) {
  const factByName = factsByName(useCapabilityMapData());
  const members = group.members.flatMap((name): ListedMember[] => {
    for (const binding of group.bindings) {
      if (!binding.members.includes(name)) continue;
      const fact = factByName.get(binding.fact);
      const member = fact?.members.find((candidate) => candidate.name === name);
      if (!member || member.internal) continue;
      return [
        {
          name,
          label: member.title ?? name,
          mono: !member.title,
          kind: "dimension",
        },
      ];
    }
    return [];
  });
  return (
    <>
      {group.description && (
        <SheetSection>
          <p className="text-sm">{group.description}</p>
        </SheetSection>
      )}
      <SheetSection title="内容清单">
        <MemberRows kind="dimension" members={members} />
      </SheetSection>
      <SheetSection title="事实绑定">
        {group.bindings.map((binding) => {
          const fact = factByName.get(binding.fact);
          return (
            <p className="text-sm" key={binding.fact}>
              {fact?.title ?? binding.fact}
              <span className="ms-2 text-pa-muted text-xs">{binding.members.length} 个维度</span>
            </p>
          );
        })}
      </SheetSection>
    </>
  );
}

/** 指标域展示规范指标、共同分析维度与正式指标图解析出的物理事实血缘。 */
function MetricDomainInspectorBody({ topic }: { topic: DataCapabilityMapMetricDomain }) {
  const capabilityMap = useCapabilityMapData();
  const factByName = factsByName(capabilityMap);
  const metrics: ListedMember[] = topic.metrics.map((metric) => ({
    name: metric.name,
    label: metric.title,
    mono: false,
    kind: "measure",
  }));
  return (
    <>
      {topic.description && (
        <SheetSection>
          <p className="text-sm">{topic.description}</p>
        </SheetSection>
      )}
      <SheetSection title="指标">
        <MemberRows kind="measure" members={metrics} />
      </SheetSection>
      {capabilityMap.dimension_groups.map((group) => {
        const names = bindingGroupIncludes(topic.dimensions, group);
        if (!names.length) return null;
        const members: ListedMember[] = names.map((name) => {
          for (const binding of group.bindings) {
            const fact = factByName.get(binding.fact);
            const member = fact?.members.find((candidate) => candidate.name === name);
            if (member) {
              return {
                name,
                label: member.title ?? name,
                mono: !member.title,
                kind: "dimension",
              };
            }
          }
          return { name, label: name, mono: true, kind: "dimension" };
        });
        return (
          <SheetSection key={group.name} title={group.title}>
            <MemberRows kind="dimension" members={members} />
          </SheetSection>
        );
      })}
      <SheetSection title="事实来源">
        {topic.bindings.map((binding) => {
          const fact = factByName.get(binding.fact);
          return (
            <p className="text-sm" key={binding.fact}>
              {fact?.title ?? binding.fact}
            </p>
          );
        })}
      </SheetSection>
    </>
  );
}

function CapabilityInspector({
  nodeRef,
  onClose,
}: {
  nodeRef: CapabilityNodeRef;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <span className="shrink-0 text-pa-ink [&_svg]:size-4" aria-hidden="true">
          {nodeIcon(nodeRef)}
        </span>
        <h3 className="min-w-0 flex-1 truncate font-medium text-sm">{nodeTitle(nodeRef)}</h3>
        <Button aria-label="关闭详情" onClick={onClose} size="icon-xs" variant="subtle">
          <XIcon />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {nodeRef.kind === "fact" && <FactInspectorBody fact={nodeRef.fact} />}
        {nodeRef.kind === "dimension_group" && (
          <DimensionGroupInspectorBody group={nodeRef.group} />
        )}
        {nodeRef.kind === "metric_domain" && <MetricDomainInspectorBody topic={nodeRef.topic} />}
      </div>
    </div>
  );
}

function MapCameraControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <Panel className="flex flex-col gap-1" position="bottom-left">
      <Button aria-label="放大" onClick={() => void zoomIn()} size="icon-sm">
        <PlusIcon aria-hidden="true" />
      </Button>
      <Button aria-label="缩小" onClick={() => void zoomOut()} size="icon-sm">
        <MinusIcon aria-hidden="true" />
      </Button>
      {/* 与首屏取景同一个 padding：两处不一致时，「回到全景」回不到人记得的那一屏 */}
      <Button aria-label="回到全景" onClick={() => void fitView(MAP_FIT_VIEW)} size="icon-sm">
        <ScanIcon aria-hidden="true" />
      </Button>
    </Panel>
  );
}

function DataCapabilityMapContent() {
  const capabilityMap = useCapabilityMapData();
  const [selected, setSelected] = useState<string | null>(null);
  const { fitView } = useReactFlow();

  const columns = useMemo(() => capabilityColumns(capabilityMap), [capabilityMap]);
  const layout = useMemo(() => layoutCapabilities(columns), [columns]);
  const edgeRefs = useMemo(() => capabilityEdges(capabilityMap), [capabilityMap]);
  const highlight = useMemo(() => highlightFor(edgeRefs, selected), [edgeRefs, selected]);

  const refs = useMemo<CapabilityNodeRef[]>(
    () => [
      ...columns.dimensions,
      ...columns.metricDomains.map((topic) => ({ kind: "metric_domain", topic }) as const),
      ...columns.facts.map((fact) => ({ kind: "fact", fact }) as const),
    ],
    [columns],
  );

  // Esc 与点空白、关闭钮同义：清除选中（检查器随之收起）
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  const cameraReady = useRef(false);
  useEffect(() => {
    if (!cameraReady.current) {
      cameraReady.current = true;
      return;
    }
    const targets = highlight ? [...highlight.nodes].map((id) => ({ id })) : undefined;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        void fitView({ duration: 300, maxZoom: 1, nodes: targets, padding: 0.15 });
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [fitView, highlight]);

  const nodes = useMemo<(CapabilityFlowNode | LaneLabelFlowNode)[]>(() => {
    const laneNodes: LaneLabelFlowNode[] = layout.laneLabels.map(({ key, position }) => ({
      id: `lane:${key}`,
      type: "lane_label" as const,
      position,
      draggable: false,
      focusable: false,
      selectable: false,
      style: { pointerEvents: "none" as const },
      data: { title: LANE_TITLES[key], hub: key === "metric_domains" },
    }));
    const capabilityNodes: CapabilityFlowNode[] = refs.map((ref) => {
      const id = nodeId(ref);
      return {
        id,
        type: "capability" as const,
        position: layout.positions.get(id) ?? { x: 0, y: 0 },
        height: NODE_HEIGHT,
        data: {
          ref,
          dimmed: highlight ? !highlight.nodes.has(id) : false,
          active: selected === id,
        },
      };
    });
    return [...laneNodes, ...capabilityNodes];
  }, [highlight, layout, refs, selected]);

  const edges = useMemo<CapabilityFlowEdge[]>(
    () =>
      visibleEdges(edgeRefs, highlight).map((edge) => {
        const lit = highlight?.edges.has(edge.id) ?? false;
        const stroke = lit ? "var(--pa-ink)" : "var(--pa-border-strong)";
        return {
          id: edge.id,
          type: "capability" as const,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          style: {
            stroke,
            strokeWidth: lit ? 2 : 1.25,
            opacity: highlight && !lit ? 0.15 : 1,
          },
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: stroke },
          // join 边点亮即语义自明，只有 binding 边的内容量值得标注
          data:
            lit && edge.kind === "binding" ? { chip: `${edge.includes} 项内容` } : ({} as const),
        };
      }),
    [edgeRefs, highlight],
  );

  const selectedRef = useMemo(
    () => refs.find((ref) => nodeId(ref) === selected) ?? null,
    [refs, selected],
  );

  const clearSelection = useCallback(() => setSelected(null), []);

  return (
    <div className={cn("flex h-full min-h-0 flex-1 flex-col", MAIN_CARD_BODY_INSET)}>
      <div className="min-h-0 flex-1">
        <div className="h-full overflow-hidden rounded-xl">
          <div className="flex h-full">
            {/* 窄屏一次只显示其一，不并排挤。 */}
            <div className={cn("min-w-0 flex-1", selected && "max-sm:hidden")}>
              <ReactFlow
                edges={edges}
                edgeTypes={EDGE_TYPES}
                fitView
                fitViewOptions={MAP_FIT_VIEW}
                maxZoom={1.5}
                minZoom={0.2}
                nodes={nodes}
                nodesConnectable={false}
                nodesDraggable={false}
                nodeTypes={NODE_TYPES}
                onNodeClick={(_, node) => {
                  if (node.type === "capability") setSelected(node.id);
                }}
                onPaneClick={clearSelection}
                panOnScroll
                proOptions={PRO_OPTIONS}
                zoomOnScroll={false}
              >
                <Background color="var(--pa-border)" gap={24} variant={BackgroundVariant.Dots} />
                <MapCameraControls />
              </ReactFlow>
            </div>
            <ViewSidebar open={selected !== null} side="right">
              {selectedRef && (
                <CapabilityInspector nodeRef={selectedRef} onClose={clearSelection} />
              )}
            </ViewSidebar>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DataCapabilityMapPage() {
  const query = useCapabilityMapQuery();
  if (query.isPending) {
    return <div className="p-6 text-pa-muted text-sm">正在加载数据能力地图…</div>;
  }
  if (!query.data) {
    return (
      <div className="p-6 text-pa-danger text-sm" role="alert">
        {errorText(query.error) ?? "数据能力地图不可用"}
      </div>
    );
  }
  return (
    <CapabilityMapContext.Provider value={query.data}>
      <ReactFlowProvider>
        <DataCapabilityMapContent />
      </ReactFlowProvider>
    </CapabilityMapContext.Provider>
  );
}
