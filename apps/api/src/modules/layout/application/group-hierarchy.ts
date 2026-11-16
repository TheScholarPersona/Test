import type { EntityManager } from '@mikro-orm/postgresql';
import { NotFoundError } from '../../../common/domain-error.js';
import { LocationGroup } from '../entities/location-group.entity.js';

/**
 * Alle Gruppen eines EntityManagers, als Baum abfragbar.
 *
 * Wird je Anfrage einmal geladen: Danach zeigen alle `parent`-Referenzen
 * (auch die von Lagerplätzen über `group`) auf geladene Objekte, und
 * Sperrketten lassen sich ohne weitere Abfragen berechnen. Bei sehr vielen
 * Gruppen (> einige tausend) wäre eine rekursive SQL-Abfrage je Kette besser.
 */
export class GroupHierarchy {
  private readonly byName = new Map<string, LocationGroup>();
  private readonly children = new Map<string, LocationGroup[]>();

  private constructor(groups: LocationGroup[]) {
    for (const group of groups) {
      this.byName.set(group.name, group);
    }
    for (const group of groups) {
      const parent = group.parent as LocationGroup | null;
      if (parent) {
        const siblings = this.children.get(parent.name) ?? [];
        siblings.push(group);
        this.children.set(parent.name, siblings);
      }
    }
  }

  static async load(em: EntityManager): Promise<GroupHierarchy> {
    return new GroupHierarchy(await em.find(LocationGroup, {}, { orderBy: { name: 'asc' } }));
  }

  all(): LocationGroup[] {
    return [...this.byName.values()];
  }

  find(name: string): LocationGroup | undefined {
    return this.byName.get(name);
  }

  get(name: string): LocationGroup {
    const group = this.byName.get(name);
    if (!group) {
      throw new NotFoundError('LOCATION_GROUP_NOT_FOUND', `Lagerplatzgruppe [${name}] existiert nicht`, { name });
    }
    return group;
  }

  childrenOf(name: string): LocationGroup[] {
    return this.children.get(name) ?? [];
  }

  /** Die Gruppe selbst und alle Untergruppen beliebiger Tiefe. */
  subtree(name: string): LocationGroup[] {
    const result: LocationGroup[] = [];
    const visit = (group: LocationGroup) => {
      result.push(group);
      this.childrenOf(group.name).forEach(visit);
    };
    visit(this.get(name));
    return result;
  }
}
