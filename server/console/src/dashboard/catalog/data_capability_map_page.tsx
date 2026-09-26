import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { LoadingMark } from "pa-result-view";
import { Button } from "@/components/ui/button";
import { InspectorProfileCard, InspectorRow, InspectorSection } from "@/components/ui/inspector";
import { ProfileAside } from "../layout/view_chrome";
import { cn } from "@/lib/utils";
import { ListCategoryPill, MAIN_CARD_BODY_INSET, useSetStageAside } from "../layout/layout_chrome";
import { errorText } from "../api";
import { useCapabilityMapQuery } from "../dashboard_queries";
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

function factsByName(data: DataCapabilityMapData): Map<string, DataCapabilityMapFact> {
  return new Map(data.facts.map((fact) => [fact.name, fact]));
}

/** 事实中已归入属性组的维度：显示在属性组下，不计入事实自身的成员。 */
function groupedNamesOf(data: DataCapabilityMapData, fact: string): Set<string> {
  return groupedMemberNames(data.dimension_groups, fact);
}

const LANE_TITLES: Record<LaneKey, string> = {
  dimensions: "维度组",
  metric_domains: "指标域",
  facts: "数据来源",
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
  summary: string;
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

function nodeSummary(ref: CapabilityNodeRef, data: DataCapabilityMapData): string {
  if (ref.kind === "metric_domain") {
    return `${ref.topic.metrics.length} 个指标 · ${ref.topic.bindings.length} 个数据来源`;
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
      <div className="px-3 pt-1 pb-2.5 text-pa-muted text-xs">{data.summary}</div>
    </div>
  );
}

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

/** 初始视图和「回到全景」共用这组参数。 */
const MAP_FIT_VIEW = { padding: 0.1 };

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

function domainTitlesOfFact(data: DataCapabilityMapData, fact: string): string[] {
  return data.metric_domains
    .filter((topic) => topic.bindings.some((binding) => binding.fact === fact))
    .map((topic) => topic.title);
}

function domainTitlesOfGroup(
  data: DataCapabilityMapData,
  group: DataCapabilityMapDimensionGroup,
): string[] {
  return data.metric_domains
    .filter((topic) => bindingGroupIncludes(topic.dimensions, group).length > 0)
    .map((topic) => topic.title);
}

function CapabilityProfileCard({
  nodeRef,
  capabilityMap,
}: {
  nodeRef: CapabilityNodeRef;
  capabilityMap: DataCapabilityMapData;
}) {
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
      label: "数据来源",
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

function FactInspectorBody({
  fact,
  capabilityMap,
}: {
  fact: DataCapabilityMapFact;
  capabilityMap: DataCapabilityMapData;
}) {
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

function DimensionGroupInspectorBody({
  group,
  capabilityMap,
}: {
  group: DataCapabilityMapDimensionGroup;
  capabilityMap: DataCapabilityMapData;
}) {
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
      <InspectorSection collapsible title="数据来源">
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

function MetricDomainInspectorBody({
  topic,
  capabilityMap,
}: {
  topic: DataCapabilityMapMetricDomain;
  capabilityMap: DataCapabilityMapData;
}) {
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

/** 右栏渲染在本页组件树之外，地图数据需要通过 props 传入。 */
function CapabilityInspector({
  nodeRef,
  capabilityMap,
  onClose,
}: {
  nodeRef: CapabilityNodeRef;
  capabilityMap: DataCapabilityMapData;
  onClose: () => void;
}) {
  return (
    <ProfileAside closeLabel="关闭详情" label="详情" onClose={onClose}>
      <CapabilityProfileCard capabilityMap={capabilityMap} nodeRef={nodeRef} />
      {nodeRef.kind === "fact" && (
        <FactInspectorBody capabilityMap={capabilityMap} fact={nodeRef.fact} />
      )}
      {nodeRef.kind === "dimension_group" && (
        <DimensionGroupInspectorBody capabilityMap={capabilityMap} group={nodeRef.group} />
      )}
      {nodeRef.kind === "metric_domain" && (
        <MetricDomainInspectorBody capabilityMap={capabilityMap} topic={nodeRef.topic} />
      )}
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
      <Button aria-label="回到全景" onClick={() => void fitView(MAP_FIT_VIEW)} size="icon-sm">
        <ScanIcon aria-hidden="true" />
      </Button>
    </Panel>
  );
}

function DataCapabilityMapContent({ capabilityMap }: { capabilityMap: DataCapabilityMapData }) {
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
          summary: nodeSummary(ref, capabilityMap),
          dimmed: highlight ? !highlight.nodes.has(id) : false,
          active: selected === id,
        },
      };
    });
    return [...laneNodes, ...capabilityNodes];
  }, [capabilityMap, highlight, layout, refs, selected]);

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

  useSetStageAside(
    () =>
      selectedRef ? (
        <CapabilityInspector
          capabilityMap={capabilityMap}
          nodeRef={selectedRef}
          onClose={clearSelection}
        />
      ) : null,
    [capabilityMap, selectedRef, clearSelection],
    clearSelection,
    "profile",
  );

  return (
    <div className={cn("flex h-full min-h-0 flex-1 flex-col", MAIN_CARD_BODY_INSET)}>
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
  if (query.isPending) return <LoadingMark />;
  if (!query.data) {
    return (
      <div className="p-6 text-pa-danger-fg text-sm" role="alert">
        {errorText(query.error) ?? "数据能力地图不可用"}
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <DataCapabilityMapContent capabilityMap={query.data} />
    </ReactFlowProvider>
  );
}
