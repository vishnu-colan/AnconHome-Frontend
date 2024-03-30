import "@lrnwebcomponents/simple-tooltip/simple-tooltip";
import { mdiAlertCircle, mdiPencilOff, mdiPlus } from "@mdi/js";
import { HassEntity } from "home-assistant-js-websocket";
import {
  CSSResultGroup,
  LitElement,
  PropertyValues,
  TemplateResult,
  css,
  html,
  nothing,
} from "lit";
import { customElement, property, state } from "lit/decorators";
import { consume } from "@lit-labs/context";
import memoizeOne from "memoize-one";
import { computeStateDomain } from "../../../common/entity/compute_state_domain";
import { navigate } from "../../../common/navigate";
import {
  LocalizeFunc,
  LocalizeKeys,
} from "../../../common/translations/localize";
import { extractSearchParam } from "../../../common/url/search-params";
import {
  DataTableColumnContainer,
  RowClickedEvent,
} from "../../../components/data-table/ha-data-table";
import "../../../components/data-table/ha-data-table-labels";
import "../../../components/ha-fab";
import "../../../components/ha-icon";
import "../../../components/ha-state-icon";
import "../../../components/ha-svg-icon";
import {
  ConfigEntry,
  subscribeConfigEntries,
} from "../../../data/config_entries";
import { getConfigFlowHandlers } from "../../../data/config_flow";
import {
  EntityRegistryEntry,
  subscribeEntityRegistry,
} from "../../../data/entity_registry";
import { domainToName } from "../../../data/integration";
import { showConfigFlowDialog } from "../../../dialogs/config-flow/show-dialog-config-flow";
import { showOptionsFlowDialog } from "../../../dialogs/config-flow/show-dialog-options-flow";
import {
  showAlertDialog,
  showConfirmationDialog,
} from "../../../dialogs/generic/show-dialog-box";
import { showMoreInfoDialog } from "../../../dialogs/more-info/show-ha-more-info-dialog";
import "../../../layouts/hass-loading-screen";
import "../../../layouts/hass-tabs-subpage-data-table";
import { SubscribeMixin } from "../../../mixins/subscribe-mixin";
import { HomeAssistant, Route } from "../../../types";
import { configSections } from "../ha-panel-config";
import "../integrations/ha-integration-overflow-menu";
import { isHelperDomain } from "./const";
import { showHelperDetailDialog } from "./show-dialog-helper-detail";
import {
  LabelRegistryEntry,
  subscribeLabelRegistry,
} from "../../../data/label_registry";
import { fullEntitiesContext } from "../../../data/context";
import "../../../components/ha-filter-labels";
import { haStyle } from "../../../resources/styles";

type HelperItem = {
  id: string;
  name: string;
  icon?: string;
  entity_id: string;
  editable?: boolean;
  type: string;
  configEntry?: ConfigEntry;
  entity?: HassEntity;
  label_entries: LabelRegistryEntry[];
};

// This groups items by a key but only returns last entry per key.
const groupByOne = <T>(
  items: T[],
  keySelector: (item: T) => string
): Record<string, T> => {
  const result: Record<string, T> = {};
  for (const item of items) {
    result[keySelector(item)] = item;
  }
  return result;
};

const getConfigEntry = (
  entityEntries: Record<string, EntityRegistryEntry>,
  configEntries: Record<string, ConfigEntry>,
  entityId: string
) => {
  const configEntryId = entityEntries![entityId]?.config_entry_id;
  return configEntryId ? configEntries![configEntryId] : undefined;
};

@customElement("ha-config-helpers")
export class HaConfigHelpers extends SubscribeMixin(LitElement) {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ type: Boolean }) public isWide = false;

  @property({ type: Boolean }) public narrow = false;

  @property({ attribute: false }) public route!: Route;

  @state() private _stateItems: HassEntity[] = [];

  @state() private _entityEntries?: Record<string, EntityRegistryEntry>;

  @state() private _configEntries?: Record<string, ConfigEntry>;

  @state() private _activeFilters?: string[];

  @state() private _filters: Record<
    string,
    { value: string[] | undefined; items: Set<string> | undefined }
  > = {};

  @state() private _expandedFilter?: string;

  @state()
  _labels!: LabelRegistryEntry[];

  @state()
  @consume({ context: fullEntitiesContext, subscribe: true })
  _entityReg!: EntityRegistryEntry[];

  @state() private _filteredStateItems?: string[] | null;

  public hassSubscribe() {
    return [
      subscribeConfigEntries(
        this.hass,
        async (messages) => {
          const newEntries = this._configEntries
            ? { ...this._configEntries }
            : {};
          messages.forEach((message) => {
            if (message.type === null || message.type === "added") {
              newEntries[message.entry.entry_id] = message.entry;
            } else if (message.type === "removed") {
              delete newEntries[message.entry.entry_id];
            } else if (message.type === "updated") {
              newEntries[message.entry.entry_id] = message.entry;
            }
          });
          this._configEntries = newEntries;
        },
        { type: ["helper"] }
      ),
      subscribeEntityRegistry(this.hass.connection!, (entries) => {
        this._entityEntries = groupByOne(entries, (entry) => entry.entity_id);
      }),
      subscribeLabelRegistry(this.hass.connection, (labels) => {
        this._labels = labels;
      }),
    ];
  }

  private _columns = memoizeOne(
    (narrow: boolean, localize: LocalizeFunc): DataTableColumnContainer => {
      const columns: DataTableColumnContainer<HelperItem> = {
        icon: {
          title: "",
          label: localize("ui.panel.config.helpers.picker.headers.icon"),
          type: "icon",
          template: (helper) =>
            helper.entity
              ? html`<ha-state-icon
                  .hass=${this.hass}
                  .stateObj=${helper.entity}
                ></ha-state-icon>`
              : html`<ha-svg-icon
                  .path=${helper.icon}
                  style="color: var(--error-color)"
                ></ha-svg-icon>`,
        },
        name: {
          title: localize("ui.panel.config.helpers.picker.headers.name"),
          main: true,
          sortable: true,
          filterable: true,
          grows: true,
          direction: "asc",
          template: (helper) => html`
            <div style="font-size: 14px;">${helper.name}</div>
            ${narrow
              ? html`<div class="secondary">${helper.entity_id}</div> `
              : nothing}
            ${helper.label_entries.length
              ? html`
                  <ha-data-table-labels
                    .labels=${helper.label_entries}
                  ></ha-data-table-labels>
                `
              : nothing}
          `,
        },
      };
      if (!narrow) {
        columns.entity_id = {
          title: localize("ui.panel.config.helpers.picker.headers.entity_id"),
          sortable: true,
          filterable: true,
          width: "25%",
        };
      }
      columns.localized_type = {
        title: localize("ui.panel.config.helpers.picker.headers.type"),
        sortable: true,
        width: "25%",
        filterable: true,
        groupable: true,
      };
      columns.editable = {
        title: "",
        label: this.hass.localize(
          "ui.panel.config.helpers.picker.headers.editable"
        ),
        type: "icon",
        template: (helper) => html`
          ${!helper.editable
            ? html`
                <div
                  tabindex="0"
                  style="display:inline-block; position: relative;"
                >
                  <ha-svg-icon .path=${mdiPencilOff}></ha-svg-icon>
                  <simple-tooltip animation-delay="0" position="left">
                    ${this.hass.localize(
                      "ui.panel.config.entities.picker.status.readonly"
                    )}
                  </simple-tooltip>
                </div>
              `
            : ""}
        `,
      };
      return columns;
    }
  );

  private _getItems = memoizeOne(
    (
      localize: LocalizeFunc,
      stateItems: HassEntity[],
      entityEntries: Record<string, EntityRegistryEntry>,
      configEntries: Record<string, ConfigEntry>,
      entityReg: EntityRegistryEntry[],
      labelReg?: LabelRegistryEntry[],
      filteredStateItems?: string[] | null
    ): HelperItem[] => {
      if (filteredStateItems === null) {
        return [];
      }

      const configEntriesCopy = { ...configEntries };

      const states = stateItems.map((entityState) => {
        const configEntry = getConfigEntry(
          entityEntries,
          configEntries,
          entityState.entity_id
        );

        if (configEntry) {
          delete configEntriesCopy[configEntry!.entry_id];
        }

        return {
          id: entityState.entity_id,
          name: entityState.attributes.friendly_name || "",
          entity_id: entityState.entity_id,
          editable:
            configEntry !== undefined || entityState.attributes.editable,
          type: configEntry
            ? configEntry.domain
            : computeStateDomain(entityState),
          configEntry,
          entity: entityState,
        };
      });

      const entries = Object.values(configEntriesCopy).map((configEntry) => ({
        id: configEntry.entry_id,
        entity_id: "",
        icon: mdiAlertCircle,
        name: configEntry.title || "",
        editable: true,
        type: configEntry.domain,
        configEntry,
        entity: undefined,
      }));

      return [...states, ...entries]
        .filter((item) =>
          filteredStateItems
            ? filteredStateItems?.includes(item.entity_id)
            : true
        )
        .map((item) => {
          const entityRegEntry = entityReg.find(
            (reg) => reg.entity_id === item.entity_id
          );
          const labels = labelReg && entityRegEntry?.labels;
          return {
            ...item,
            localized_type: item.configEntry
              ? domainToName(localize, item.type)
              : localize(
                  `ui.panel.config.helpers.types.${item.type}` as LocalizeKeys
                ) || item.type,
            label_entries: (labels || []).map(
              (lbl) => labelReg!.find((label) => label.label_id === lbl)!
            ),
          };
        });
    }
  );

  protected render(): TemplateResult {
    if (
      !this.hass ||
      this._stateItems === undefined ||
      this._entityEntries === undefined ||
      this._configEntries === undefined
    ) {
      return html` <hass-loading-screen></hass-loading-screen> `;
    }

    return html`
      <hass-tabs-subpage-data-table
        .hass=${this.hass}
        .narrow=${this.narrow}
        back-path="/config"
        .route=${this.route}
        .tabs=${configSections.devices}
        hasFilters
        .filters=${Object.values(this._filters).filter(
          (filter) => filter.value?.length
        ).length}
        .columns=${this._columns(this.narrow, this.hass.localize)}
        .data=${this._getItems(
          this.hass.localize,
          this._stateItems,
          this._entityEntries,
          this._configEntries,
          this._entityReg,
          this._labels,
          this._filteredStateItems
        )}
        .activeFilters=${this._activeFilters}
        @clear-filter=${this._clearFilter}
        @row-click=${this._openEditDialog}
        hasFab
        clickable
        .noDataText=${this.hass.localize(
          "ui.panel.config.helpers.picker.no_helpers"
        )}
        class=${this.narrow ? "narrow" : ""}
      >
        <ha-filter-labels
          .hass=${this.hass}
          .value=${this._filters["ha-filter-labels"]?.value}
          @data-table-filter-changed=${this._filterChanged}
          slot="filter-pane"
          .expanded=${this._expandedFilter === "ha-filter-labels"}
          .narrow=${this.narrow}
          @expanded-changed=${this._filterExpanded}
        ></ha-filter-labels>

        <ha-integration-overflow-menu
          .hass=${this.hass}
          slot="toolbar-icon"
        ></ha-integration-overflow-menu>
        <ha-fab
          slot="fab"
          .label=${this.hass.localize(
            "ui.panel.config.helpers.picker.create_helper"
          )}
          extended
          @click=${this._createHelper}
        >
          <ha-svg-icon slot="icon" .path=${mdiPlus}></ha-svg-icon>
        </ha-fab>
      </hass-tabs-subpage-data-table>
    `;
  }

  private _filterExpanded(ev) {
    if (ev.detail.expanded) {
      this._expandedFilter = ev.target.localName;
    } else if (this._expandedFilter === ev.target.localName) {
      this._expandedFilter = undefined;
    }
  }

  private _filterChanged(ev) {
    const type = ev.target.localName;
    this._filters[type] = ev.detail;
    this._applyFilters();
  }

  private _applyFilters() {
    const filters = Object.entries(this._filters);
    let items: Set<string> | undefined;
    for (const [key, filter] of filters) {
      if (filter.items) {
        if (!items) {
          items = filter.items;
          continue;
        }
        items =
          "intersection" in items
            ? // @ts-ignore
              items.intersection(filter.items)
            : new Set([...items].filter((x) => filter.items!.has(x)));
      }
      if (key === "ha-filter-labels" && filter.value?.length) {
        const labelItems: Set<string> = new Set();
        this._stateItems
          .filter((stateItem) =>
            this._entityReg
              .find((reg) => reg.entity_id === stateItem.entity_id)
              ?.labels.some((lbl) => filter.value!.includes(lbl))
          )
          .forEach((stateItem) => labelItems.add(stateItem.entity_id));
        if (!items) {
          items = labelItems;
          continue;
        }
        items =
          "intersection" in items
            ? // @ts-ignore
              items.intersection(labelItems)
            : new Set([...items].filter((x) => labelItems!.has(x)));
      }
    }
    this._filteredStateItems = items ? [...items] : undefined;
  }

  private _clearFilter() {
    this._filters = {};
    this._applyFilters();
  }

  protected firstUpdated(changedProps: PropertyValues) {
    super.firstUpdated(changedProps);
    if (this.route.path === "/add") {
      this._handleAdd();
    }
  }

  private async _handleAdd() {
    const domain = extractSearchParam("domain");
    navigate("/config/helpers", { replace: true });
    if (!domain) {
      return;
    }
    if (isHelperDomain(domain)) {
      showHelperDetailDialog(this, {
        domain,
      });
      return;
    }
    const handlers = await getConfigFlowHandlers(this.hass, ["helper"]);

    if (!handlers.includes(domain)) {
      const integrations = await getConfigFlowHandlers(this.hass, [
        "device",
        "hub",
        "service",
      ]);
      if (integrations.includes(domain)) {
        navigate(`/config/integrations/add?domain=${domain}`, {
          replace: true,
        });
        return;
      }
      showAlertDialog(this, {
        title: this.hass.localize(
          "ui.panel.config.integrations.config_flow.error"
        ),
        text: this.hass.localize(
          "ui.panel.config.integrations.config_flow.no_config_flow"
        ),
      });
      return;
    }
    const localize = await this.hass.loadBackendTranslation(
      "title",
      domain,
      true
    );
    if (
      !(await showConfirmationDialog(this, {
        title: this.hass.localize("ui.panel.config.integrations.confirm_new", {
          integration: domainToName(localize, domain),
        }),
      }))
    ) {
      return;
    }
    showConfigFlowDialog(this, {
      startFlowHandler: domain,
      showAdvanced: this.hass.userData?.showAdvanced,
    });
  }

  protected willUpdate(changedProps: PropertyValues) {
    super.willUpdate(changedProps);

    if (!this._entityEntries || !this._configEntries) {
      return;
    }

    let changed =
      !this._stateItems ||
      changedProps.has("_entityEntries") ||
      changedProps.has("_configEntries");

    if (!changed && changedProps.has("hass")) {
      const oldHass = changedProps.get("hass") as HomeAssistant | undefined;
      changed = !oldHass || oldHass.states !== this.hass.states;
    }
    if (!changed) {
      return;
    }

    const extraEntities = new Set<string>();

    for (const entityEntry of Object.values(this._entityEntries)) {
      if (
        entityEntry.config_entry_id &&
        entityEntry.config_entry_id in this._configEntries
      ) {
        extraEntities.add(entityEntry.entity_id);
      }
    }

    const newStates = Object.values(this.hass!.states).filter(
      (entity) =>
        extraEntities.has(entity.entity_id) ||
        isHelperDomain(computeStateDomain(entity))
    );

    if (
      this._stateItems.length !== newStates.length ||
      !this._stateItems.every((val, idx) => newStates[idx] === val)
    ) {
      this._stateItems = newStates;
    }
  }

  private async _openEditDialog(ev: CustomEvent): Promise<void> {
    const id = (ev.detail as RowClickedEvent).id;
    if (id.includes(".")) {
      showMoreInfoDialog(this, { entityId: id });
    } else {
      showOptionsFlowDialog(this, this._configEntries![id]);
    }
  }

  private _createHelper() {
    showHelperDetailDialog(this, {});
  }

  static get styles(): CSSResultGroup {
    return [
      haStyle,
      css`
        hass-tabs-subpage-data-table {
          --data-table-row-height: 60px;
        }
        hass-tabs-subpage-data-table.narrow {
          --data-table-row-height: 72px;
        }
      `,
    ];
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-config-helpers": HaConfigHelpers;
  }
}
