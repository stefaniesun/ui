import {
  checkDocumentInvariants, type ElementNode, type ElementType, type Rect,
  type Region, type RegionSplitDoc,
} from "./types.js";

function contains(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

function assertValid(doc: RegionSplitDoc): RegionSplitDoc {
  const violations = checkDocumentInvariants(doc);
  if (violations.length) throw new Error(violations.map(item => item.message).join("; "));
  return doc;
}

function update(doc: RegionSplitDoc, elements: ElementNode[]): RegionSplitDoc {
  return assertValid({ ...doc, elements });
}

function descendants(elements: ElementNode[], id: string): Set<string> {
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of elements) {
      if (element.parentId && ids.has(element.parentId) && !ids.has(element.id)) { ids.add(element.id); changed = true; }
    }
  }
  return ids;
}

export function reconcileElementsWithRegions(
  elements: ElementNode[], regions: Region[], image: { width: number; height: number },
): ElementNode[] {
  const result = elements.map(element => ({ ...element, bounds: { ...element.bounds } }));
  const children = new Map<string, ElementNode[]>();
  for (const item of result) if (item.parentId) children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]);
  const sync = (item: ElementNode, regionId: string, conflict: boolean): void => {
    item.regionId = regionId;
    item.conflict = conflict;
    for (const child of children.get(item.id) ?? []) sync(child, regionId, conflict);
  };
  for (const item of result.filter(element => element.parentId === null)) {
    const matches = regions.filter(region => contains(region.bounds, item.bounds));
    if (matches.length === 1) sync(item, matches[0]!.id, false);
    else sync(item, item.regionId, true);
  }
  void image;
  return result;
}

export function addElement(doc: RegionSplitDoc, element: ElementNode): RegionSplitDoc {
  return update(doc, [...doc.elements, element]);
}

export function moveElementTree(doc: RegionSplitDoc, elementId: string, dx: number, dy: number): RegionSplitDoc {
  if (!doc.elements.some(item => item.id === elementId)) return doc;
  const ids = descendants(doc.elements, elementId);
  const moved = doc.elements.map(item => ids.has(item.id)
    ? { ...item, bounds: { ...item.bounds, x: item.bounds.x + dx, y: item.bounds.y + dy } }
    : item);
  return update(doc, reconcileElementsWithRegions(moved, doc.regions, doc.image));
}

export function resizeElement(doc: RegionSplitDoc, elementId: string, bounds: Rect): RegionSplitDoc {
  if (!doc.elements.some(item => item.id === elementId)) return doc;
  const resized = doc.elements.map(item => item.id === elementId ? { ...item, bounds: { ...bounds } } : item);
  return update(doc, reconcileElementsWithRegions(resized, doc.regions, doc.image));
}

export function deleteElementTree(doc: RegionSplitDoc, elementId: string): RegionSplitDoc {
  const ids = descendants(doc.elements, elementId);
  return update(doc, doc.elements.filter(item => !ids.has(item.id)));
}

export function renameElement(doc: RegionSplitDoc, elementId: string, displayName: string): RegionSplitDoc {
  return update(doc, doc.elements.map(item => item.id === elementId ? { ...item, displayName } : item));
}

export function changeElementType(doc: RegionSplitDoc, elementId: string, type: ElementType): RegionSplitDoc {
  return update(doc, doc.elements.map(item => item.id === elementId ? { ...item, type } : item));
}

export function reparentElement(doc: RegionSplitDoc, elementId: string, parentId: string | null): RegionSplitDoc {
  if (parentId && descendants(doc.elements, elementId).has(parentId)) throw new Error("element parent cycle");
  return update(doc, doc.elements.map(item => item.id === elementId ? { ...item, parentId } : item));
}
