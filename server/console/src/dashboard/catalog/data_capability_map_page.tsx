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
  LayersIcon,
  MinusIcon,
  PlusIcon,
  ScanIcon,
  SigmaIcon,
  TagIcon,
} from "lucide-react";
import type {
  DataCapabilityMapMetricDomain,
  DataCapabilityMapFact,
  DataCapabilityMapData,
  DataCapabilityMapDimensionGroup,
} from "@data-capability-map";
import { PLOT_RADIUS } from "@charts";
import { Button } from "@/components/ui/button";
import { InspectorProfileCard, InspectorRow, InspectorSection } from "@/components/ui/inspector";
import { ProfileAside } from "../layout/view_chrome";
import { cn } from "@/lib/utils";
import { ListCategoryPill, MAIN_CARD_BODY_INSET, useSetStageAside } from "../layout/layout_chrome";
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
  listedHierarchies,
  listedMembers,
  memberCounts,
  nodeId,
  visibleEdges,
  type CapabilityNodeRef,
  type LaneKey,
  type ListedMember,
} from "./data_capability_map";

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
  if (ref.kind === "fact") return ref.fact.title;
  if (ref.kind === "dimension_group") return ref.group.title;
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

/** 清单行：左图标 + 业务名。右侧留给读者用得上的口径说明，不印物理名与语义 id。 */
function MemberRow({ member }: { member: ListedMember }) {
  return (
    <InspectorRow
      icon={member.kind === "dimension" ? <TagIcon /> : <SigmaIcon />}
      label={member.label}
    />
  );
}

function MemberListSection({
  title,
  members,
  kind,
}: {
  title: string;
  members: ListedMember[];
  kind: ListedMember["kind"];
}) {
  const group = members.filter((member) => member.kind === kind);
  if (!group.length) return null;
  return (
    <InspectorSection collapsible title={title}>
      {group.map((member) => (
        <MemberRow key={member.name} member={member} />
      ))}
    </InspectorSection>
  );
}

/** 关系行：label 左，指向的那些记录各成一枚芯片——这些名字是这一行的全部内容。 */
function RelationRow({ label, names }: { label: string; names: string[] }) {
  return (
    <InspectorRow label={label}>
      <div className="flex flex-wrap justify-end gap-1">
        {names.map((name) => (
          <ListCategoryPill key={name}>{name}</ListCategoryPill>
        ))}
      </div>
    </InspectorRow>
  );
}

/** 该事实被哪些指标域取用：地图上那是一根线，档案里要读得出名字。 */
function domainTitlesOfFact(data: DataCapabilityMapData, fact: string): string[] {
  return data.metric_domains
    .filter((topic) => topic.bindings.some((binding) => binding.fact === fact))
    .map((topic) => topic.title);
}

/** 该属性组的维度进了哪些指标域的共同维度空间。 */
function domainTitlesOfGroup(
  data: DataCapabilityMapData,
  group: DataCapabilityMapDimensionGroup,
): string[] {
  return data.metric_domains
    .filter((topic) => bindingGroupIncludes(topic.dimensions, group).length > 0)
    .map((topic) => topic.title);
}

/**
 * 头卡：这一条构件本身是什么——名字、口径，以及它在图上那几根线读不出名字的去向。
 * 物理表名与语义 id 不进这里：控制台只说业务的话。
 */
function CapabilityProfileCard({ nodeRef }: { nodeRef: CapabilityNodeRef }) {
  const capabilityMap = useCapabilityMapData();
  const relations: { label: string; names: string[] }[] = [];
  let description: string | null = null;
  if (nodeRef.kind === "fact") {
    description = nodeRef.fact.description;
    relations.push({
      label: "所属指标域",
      names: domainTitlesOfFact(capabilityMap, nodeRef.fact.name),
    });
  } else if (nodeRef.kind === "dimension_group") {
    description = nodeRef.group.description;
    relations.push({ label: "可用于", names: domainTitlesOfGroup(capabilityMap, nodeRef.group) });
  } else {
    description = nodeRef.topic.description;
    const factByName = factsByName(capabilityMap);
    relations.push({
      label: "事实来源",
      names: nodeRef.topic.bindings.flatMap((binding) => {
        const title = factByName.get(binding.fact)?.title;
        return title ? [title] : [];
      }),
    });
  }
  const shown = relations.filter((relation) => relation.names.length > 0);
  return (
    <InspectorProfileCard
      description={description}
      icon={nodeIcon(nodeRef)}
      title={nodeTitle(nodeRef)}
    >
      {shown.map((relation) => (
        <RelationRow key={relation.label} label={relation.label} names={relation.names} />
      ))}
    </InspectorProfileCard>
  );
}

function FactInspectorBody({ fact }: { fact: DataCapabilityMapFact }) {
  const capabilityMap = useCapabilityMapData();
  // 被属性组认领的维度归属左列组节点，事实本体清单只列剩余内容。
  const grouped = groupedNamesOf(capabilityMap, fact.name);
  const own = listedMembers(
    fact,
    fact.members
      .filter((member) => !member.internal && !grouped.has(member.name))
      .map((member) => member.name),
  );
  const hierarchies = listedHierarchies(fact);
  return (
    <>
      <MemberListSection kind="dimension" members={own} title="分析维度" />
      <MemberListSection kind="measure" members={own} title="指标" />
      {hierarchies.length > 0 && (
        <InspectorSection collapsible title="部门树">
          {hierarchies.map((hierarchy) => (
            <InspectorRow key={hierarchy.name} label={hierarchy.title}>
              {hierarchy.levels.join(" → ")}
            </InspectorRow>
          ))}
        </InspectorSection>
      )}
    </>
  );
}

function DimensionGroupInspectorBody({ group }: { group: DataCapabilityMapDimensionGroup }) {
  const capabilityMap = useCapabilityMapData();
  const factByName = factsByName(capabilityMap);
  const members = group.members.flatMap((name): ListedMember[] => {
    for (const binding of group.bindings) {
      if (!binding.members.includes(name)) continue;
      const fact = factByName.get(binding.fact);
      const member = fact?.members.find((candidate) => candidate.name === name);
      if (!member || member.internal || !member.title) continue;
      return [{ name, label: member.title, kind: "dimension" }];
    }
    return [];
  });
  return (
    <>
      <MemberListSection kind="dimension" members={members} title="分析维度" />
      <InspectorSection collapsible title="事实绑定">
        {group.bindings.flatMap((binding) => {
          const title = factByName.get(binding.fact)?.title;
          if (!title) return [];
          return [
            <InspectorRow key={binding.fact} label={title}>
              {`${binding.members.length} 个维度`}
            </InspectorRow>,
          ];
        })}
      </InspectorSection>
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
    kind: "measure",
  }));
  return (
    <>
      <MemberListSection kind="measure" members={metrics} title="指标" />
      {capabilityMap.dimension_groups.map((group) => {
        const names = bindingGroupIncludes(topic.dimensions, group);
        if (!names.length) return null;
        const members: ListedMember[] = names.flatMap((name): ListedMember[] => {
          for (const binding of group.bindings) {
            const fact = factByName.get(binding.fact);
            const title = fact?.members.find((candidate) => candidate.name === name)?.title;
            if (title) return [{ name, label: title, kind: "dimension" }];
          }
          return [];
        });
        return (
          <MemberListSection
            key={group.name}
            kind="dimension"
            members={members}
            title={group.title}
          />
        );
      })}
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
    <ProfileAside closeLabel="关闭详情" label="能力档案" onClose={onClose}>
      <CapabilityProfileCard nodeRef={nodeRef} />
      {nodeRef.kind === "fact" && <FactInspectorBody fact={nodeRef.fact} />}
      {nodeRef.kind === "dimension_group" && <DimensionGroupInspectorBody group={nodeRef.group} />}
      {nodeRef.kind === "metric_domain" && <MetricDomainInspectorBody topic={nodeRef.topic} />}
    </ProfileAside>
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
        const stroke = lit ? "var(--pa-ink)" : "var(--pa-line-strong)";
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

  /*
    档案由壳渲染，落在本页的 Provider 之外——语义包上下文要随节点一起交出去，
    否则档案里读上下文的那几处会当场抛「缺少运行时语义包上下文」。
  */
  useSetStageAside(
    () =>
      selectedRef ? (
        <CapabilityMapContext.Provider value={capabilityMap}>
          <CapabilityInspector nodeRef={selectedRef} onClose={clearSelection} />
        </CapabilityMapContext.Provider>
      ) : null,
    [capabilityMap, selectedRef, clearSelection],
    clearSelection,
    "profile",
  );

  return (
    <div className={cn("flex h-full min-h-0 flex-1 flex-col", MAIN_CARD_BODY_INSET)}>
      {/*
        画布的场地：与结果面那圈发丝框同一件事——框圈住绘图区，与里面长成什么样无关。
        半径取 `PLOT_RADIUS`（图表场地的同一个数），两处各写一个数就会差出一档圆角。
      */}
      <div
        className="min-h-0 flex-1 overflow-hidden border border-pa-line"
        style={{ borderRadius: PLOT_RADIUS }}
      >
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
          <Background color="var(--pa-line)" gap={24} variant={BackgroundVariant.Dots} />
          <MapCameraControls />
        </ReactFlow>
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
