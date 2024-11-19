import { mdiLightbulbOutline } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators";
import type { HomeAssistant } from "../types";

import "./ha-svg-icon";

@customElement("ha-tip")
class HaTip extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  public render() {
    if (!this.hass) {
      return nothing;
    }

    return html`
      <ha-svg-icon .path=${mdiLightbulbOutline}></ha-svg-icon>
      <span class="prefix"
        >${this.hass.localize("ui.panel.config.tips.tip")}</span
      >
      <span class="text"
        ><a
          href="https://www.anconsystem.com/"
          target="_blank"
          class="ancon-url"
          >www.anconsystem.com</a
        ></span
      >
    `;
  }

  static styles = css`
    :host {
      display: block;
      text-align: center;
    }

    .text {
      direction: var(--direction);
      margin-left: 2px;
      margin-inline-start: 2px;
      margin-inline-end: initial;
      color: var(--secondary-text-color);
    }

    .prefix {
      font-weight: 500;
    }
    .ancon-url {
      color: #039be5;
      text-decoration: none;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-tip": HaTip;
  }
}
