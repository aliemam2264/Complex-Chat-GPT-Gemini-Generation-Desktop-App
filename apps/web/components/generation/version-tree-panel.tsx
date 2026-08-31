"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Network } from "lucide-react";

import { getAssetUrl } from "@/lib/api";
import type { Asset } from "@/types/project";

type VersionTreeNode = {
  asset: Asset;
  children: VersionTreeNode[];
};

type Props = {
  assets: Asset[];
  selectedSourceId: string | null;
  selectedVersionIds: string[];
  onSelectSource: (assetId: string) => void;
  onToggleDeleteSelection: (assetId: string) => void;
};

function buildVersionLabelMap(assets: Asset[]) {
  const labels = new Map<string, string>();
  let generatedIndex = 0;

  for (const asset of assets) {
    if (asset.type === "ORIGINAL") {
      labels.set(asset.id, "Original");
      continue;
    }

    generatedIndex += 1;
    labels.set(asset.id, `V${generatedIndex}`);
  }

  return labels;
}

function buildVersionTree(assets: Asset[]) {
  const assetById = new Map(assets.map((asset) => [asset.id, asset] as const));
  const childrenByParentId = new Map<string, Asset[]>();
  const roots: Asset[] = [];

  for (const asset of assets) {
    const parentExists = asset.parentAssetId ? assetById.has(asset.parentAssetId) : false;

    if (!asset.parentAssetId || !parentExists) {
      roots.push(asset);
      continue;
    }

    const children = childrenByParentId.get(asset.parentAssetId) ?? [];
    children.push(asset);
    childrenByParentId.set(asset.parentAssetId, children);
  }

  const visited = new Set<string>();

  function makeNode(asset: Asset, ancestry: Set<string>): VersionTreeNode {
    visited.add(asset.id);

    if (ancestry.has(asset.id)) {
      return {
        asset,
        children: [],
      };
    }

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(asset.id);

    const children = (childrenByParentId.get(asset.id) ?? [])
      .filter((child) => !nextAncestry.has(child.id))
      .map((child) => makeNode(child, nextAncestry));

    return {
      asset,
      children,
    };
  }

  const tree = roots.map((asset) => makeNode(asset, new Set()));

  // Defensive fallback for malformed/cyclic data: never hide an asset from the UI.
  for (const asset of assets) {
    if (!visited.has(asset.id)) {
      tree.push(makeNode(asset, new Set()));
    }
  }

  return tree;
}

type NodeProps = {
  node: VersionTreeNode;
  depth: number;
  labelById: Map<string, string>;
  selectedSourceId: string | null;
  selectedVersionIds: string[];
  collapsedIds: Set<string>;
  onToggleCollapsed: (assetId: string) => void;
  onSelectSource: (assetId: string) => void;
  onToggleDeleteSelection: (assetId: string) => void;
};

function VersionTreeNodeRow({
  node,
  depth,
  labelById,
  selectedSourceId,
  selectedVersionIds,
  collapsedIds,
  onToggleCollapsed,
  onSelectSource,
  onToggleDeleteSelection,
}: NodeProps) {
  const { asset, children } = node;
  const active = asset.id === selectedSourceId;
  const selectedForDelete = selectedVersionIds.includes(asset.id);
  const collapsed = collapsedIds.has(asset.id);
  const hasChildren = children.length > 0;
  const label = labelById.get(asset.id) ?? "Version";
  const parentLabel = asset.parentAssetId ? labelById.get(asset.parentAssetId) : null;

  return (
    <div className="relative">
      <div className="relative flex items-center gap-2 py-1.5">
        {depth > 0 && (
          <div className="absolute -left-5 top-1/2 h-px w-5 -translate-y-1/2 bg-[var(--border)]" />
        )}

        <button
          type="button"
          onClick={() => {
            if (hasChildren) {
              onToggleCollapsed(asset.id);
            }
          }}
          disabled={!hasChildren}
          aria-label={hasChildren ? (collapsed ? `Expand ${label}` : `Collapse ${label}`) : undefined}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--foreground-subtle)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:cursor-default disabled:opacity-25"
        >
          {hasChildren ? (
            collapsed ? (
              <ChevronRight size={14} strokeWidth={1.8} />
            ) : (
              <ChevronDown size={14} strokeWidth={1.8} />
            )
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
          )}
        </button>

        <div
          className={[
            "relative flex min-w-[280px] max-w-[360px] flex-1 items-center gap-3 rounded-xl border p-2 transition-colors",
            selectedForDelete
              ? "border-[var(--danger)] bg-[var(--surface-2)]"
              : active
                ? "border-[var(--foreground)] bg-[var(--surface-2)]"
                : "border-[var(--border)] bg-[var(--background)] hover:border-[var(--foreground-subtle)]",
          ].join(" ")}
        >
          <button
            type="button"
            onClick={() => onSelectSource(asset.id)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <div className="h-[54px] w-[82px] shrink-0 overflow-hidden rounded-lg bg-[var(--surface-2)]">
              <img
                src={getAssetUrl(asset.filePath)}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-[var(--foreground)]">{label}</span>

                {active && (
                  <span className="rounded-full border border-[var(--foreground)]/20 bg-[var(--foreground)]/10 px-2 py-0.5 text-[10px] text-[var(--foreground)]">
                    Current source
                  </span>
                )}
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--foreground-subtle)]">
                {asset.type === "ORIGINAL" ? (
                  <span>Root version</span>
                ) : (
                  <span>From {parentLabel ?? "previous version"}</span>
                )}

                {hasChildren && (
                  <>
                    <span>·</span>
                    <span>
                      {children.length} {children.length === 1 ? "branch" : "branches"}
                    </span>
                  </>
                )}
              </div>
            </div>
          </button>

          {asset.type === "GENERATED" && (
            <button
              type="button"
              onClick={() => onToggleDeleteSelection(asset.id)}
              aria-label={selectedForDelete ? `Unselect ${label} for deletion` : `Select ${label} for deletion`}
              aria-pressed={selectedForDelete}
              title={selectedForDelete ? "Remove from deletion selection" : "Select for deletion"}
              className={[
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                selectedForDelete
                  ? "border-[var(--danger)] bg-[var(--danger)] text-black"
                  : "border-[var(--border)] text-[var(--foreground-subtle)] hover:border-[var(--foreground-subtle)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]",
              ].join(" ")}
            >
              {selectedForDelete ? (
                <Check size={13} strokeWidth={2.4} />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
            </button>
          )}
        </div>
      </div>

      {hasChildren && !collapsed && (
        <div className="relative ml-[14px] border-l border-[var(--border)] pl-5">
          {children.map((child) => (
            <VersionTreeNodeRow
              key={child.asset.id}
              node={child}
              depth={depth + 1}
              labelById={labelById}
              selectedSourceId={selectedSourceId}
              selectedVersionIds={selectedVersionIds}
              collapsedIds={collapsedIds}
              onToggleCollapsed={onToggleCollapsed}
              onSelectSource={onSelectSource}
              onToggleDeleteSelection={onToggleDeleteSelection}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function VersionTreePanel({
  assets,
  selectedSourceId,
  selectedVersionIds,
  onSelectSource,
  onToggleDeleteSelection,
}: Props) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());

  const labelById = useMemo(() => buildVersionLabelMap(assets), [assets]);
  const tree = useMemo(() => buildVersionTree(assets), [assets]);

  const branchCount = useMemo(
    () => assets.filter((asset) => assets.some((candidate) => candidate.parentAssetId === asset.id)).length,
    [assets],
  );

  function toggleCollapsed(assetId: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);

      if (next.has(assetId)) {
        next.delete(assetId);
      } else {
        next.add(assetId);
      }

      return next;
    });
  }

  function collapseAll() {
    const parentIds = new Set(
      assets
        .filter((asset) => assets.some((candidate) => candidate.parentAssetId === asset.id))
        .map((asset) => asset.id),
    );

    setCollapsedIds(parentIds);
  }

  function expandAll() {
    setCollapsedIds(new Set());
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-soft)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Network size={14} strokeWidth={1.8} className="text-[var(--foreground-muted)]" />
          <span className="text-xs text-[var(--foreground-muted)]">
            {assets.length} {assets.length === 1 ? "version" : "versions"}
          </span>
          <span className="text-[var(--foreground-subtle)]">·</span>
          <span className="text-xs text-[var(--foreground-subtle)]">
            {branchCount} {branchCount === 1 ? "branch point" : "branch points"}
          </span>
        </div>

        {branchCount > 0 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={expandAll}
              className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--foreground-subtle)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={collapseAll}
              className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--foreground-subtle)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            >
              Collapse all
            </button>
          </div>
        )}
      </div>

      <div className="max-h-[500px] overflow-auto px-4 py-3">
        <div className="min-w-max pr-4">
          {tree.map((node) => (
            <VersionTreeNodeRow
              key={node.asset.id}
              node={node}
              depth={0}
              labelById={labelById}
              selectedSourceId={selectedSourceId}
              selectedVersionIds={selectedVersionIds}
              collapsedIds={collapsedIds}
              onToggleCollapsed={toggleCollapsed}
              onSelectSource={onSelectSource}
              onToggleDeleteSelection={onToggleDeleteSelection}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
