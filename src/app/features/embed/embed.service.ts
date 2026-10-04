/* Copyright (c) 2026 myteklab
   SPDX-License-Identifier: GPL-3.0-or-later */

import { createEnvironmentInjector, EnvironmentInjector, Injectable, NgZone } from '@angular/core';
import { BridgeService, BridgeServiceSessionStateKey } from '../../shared/services/bridge.service';
import { CartoonJointRenderingService } from '../../shared/services/cartoon-joint-rendering.service';
import { CartoonOptionMask, CartoonRenderingService } from '../../shared/services/cartoon-rendering.service';
import { CartoonSiteRenderingService } from '../../shared/services/cartoon-site-rendering.service';
import { CartoonSketchRenderingService } from '../../shared/services/cartoon-sketch-rendering.service';
import { ViewportTransform2D } from '../../shared/services/viewport-transform.service';
import { DesignConditionsService } from '../../shared/services/design-conditions.service';
import { EventBrokerService, EventOrigin } from '../../shared/services/event-broker.service';
import { PersistenceService } from '../../shared/services/persistence.service';
import { ToastError } from '../toast/toast/toast-error';
import { DEFAULT_SAVE_FILE_NAME } from '../save-load/save-load.service';
import { SaveMarkService } from '../save-load/save-mark.service';

/**
 * Lets a host page that keeps designs in its own storage run the app in an iframe. The host opts in by setting
 * `window.bridgeDesignerHost = {}` before the app boots. Without that, nothing here does anything.
 *
 * Startup is held until the host calls `start()`, because the host only knows whether there is a design to open
 * after its own fetch completes. Running the welcome sequence first and then yanking it away flashes dialogs.
 */
@Injectable({ providedIn: 'root' })
export class EmbedService {
  private readonly isHostedFlag: boolean = !!(window as any).bridgeDesignerHost;
  private welcomeStart: (() => void) | undefined;
  private quietStart: (() => void) | undefined;
  private saveHandler: ((text: string) => unknown) | undefined;
  private changeHandler: ((isUnsaved: boolean) => void) | undefined;
  /**
   * Set for a design the host has never stored: one from the setup wizard, a sample or a template. The app counts
   * those as saved, because there is nothing on disk to lose yet, but the host's copy is still the old one (or none),
   * so a reload would drop the new bridge with no warning.
   */
  private isNeverStored: boolean = false;
  private previewInjector: EnvironmentInjector | undefined;

  constructor(
    private readonly bridgeService: BridgeService,
    private readonly eventBrokerService: EventBrokerService,
    private readonly persistenceService: PersistenceService,
    private readonly saveMarkService: SaveMarkService,
    private readonly zone: NgZone,
    private readonly environmentInjector: EnvironmentInjector,
  ) {}

  public get isHosted(): boolean {
    return this.isHostedFlag;
  }

  /** Whether plain Save goes to the host. Save As still downloads a file, which contests need. */
  public get savesToHost(): boolean {
    return this.saveHandler !== undefined;
  }

  /**
   * Called once from app startup in place of the welcome sequence. `welcomeStart` is the normal sequence for a
   * fresh design; `quietStart` does the browser feature checks without dialogs, for a design the host opens.
   */
  public deferStartup(welcomeStart: () => void, quietStart: () => void): void {
    this.welcomeStart = welcomeStart;
    this.quietStart = quietStart;
    this.eventBrokerService.editCommandCompletion.subscribe(() => this.reportChange());
    // Subscribed after the drafting panel's own handler, so the load and its saved-mark reset have both happened.
    this.eventBrokerService.loadBridgeRequest.subscribe(info => {
      if (info.data.invalidateSavedMark) {
        this.isNeverStored = true;
      }
      this.reportChange();
    });
    // Published only now, so the host can't call start() before there is something to start.
    (window as any).bridgeDesigner = this.createApi();
  }

  public saveToHost(): void {
    if (!this.saveHandler) {
      return;
    }
    // Marked before the host finishes. The host owns retries and failure messages; a stale mark only costs a
    // missing "unsaved" prompt, while marking late would also mark any edits made during the save.
    const text = this.bridgeService.saveSetText;
    this.markStored();
    this.saveHandler(text);
  }

  private start(text: string | null, name?: string): void {
    const welcomeStart = this.welcomeStart;
    const quietStart = this.quietStart;
    if (!welcomeStart || !quietStart) {
      // A second call after startup just opens the design.
      if (text) {
        this.loadDesign(text, name);
      }
      return;
    }
    this.welcomeStart = this.quietStart = undefined;
    if (text && this.loadDesign(text, name, quietStart)) {
      return;
    }
    welcomeStart();
  }

  /** Returns false when the text doesn't parse, after the user has seen why. */
  private loadDesign(text: string, name?: string, beforeLoad?: () => void): boolean {
    let saveSet;
    try {
      saveSet = this.persistenceService.parseSaveSetText(text);
      this.persistenceService.validateSaveSet(saveSet);
    } catch (error) {
      const kind = error instanceof ToastError ? error.kind : 'parseError';
      this.eventBrokerService.toastRequest.next({ origin: EventOrigin.SERVICE, data: kind });
      return false;
    }
    beforeLoad?.();
    this.eventBrokerService.loadBridgeRequest.next({ origin: EventOrigin.SERVICE, data: saveSet });
    this.saveMarkService.markDesignSaved(name ?? DEFAULT_SAVE_FILE_NAME);
    this.isNeverStored = false;
    this.reportChange();
    return true;
  }

  private get isUnsaved(): boolean {
    return this.isNeverStored || this.saveMarkService.isDesignUnsaved;
  }

  private markStored(): void {
    this.saveMarkService.markDesignSaved(this.saveMarkService.savedFileName ?? DEFAULT_SAVE_FILE_NAME);
    this.isNeverStored = false;
    this.reportChange();
  }

  private reportChange(): void {
    this.changeHandler?.(this.isUnsaved);
  }

  /**
   * A gallery picture: the site as the setup wizard draws it, with this bridge's members over it. Rendered off screen
   * from the model, so it doesn't depend on the drafting view's zoom, selection or whether it's showing at all.
   */
  private renderPreview(width: number, height: number): string {
    if (this.bridgeService.designConditions === DesignConditionsService.PLACEHOLDER_CONDITIONS) {
      return '';
    }
    // The same component-scoped providers the template dialog uses, so the root drafting state is untouched.
    this.previewInjector ??= createEnvironmentInjector(
      [
        BridgeService,
        { provide: BridgeServiceSessionStateKey, useValue: { key: undefined } },
        CartoonJointRenderingService,
        CartoonRenderingService,
        CartoonSiteRenderingService,
        CartoonSketchRenderingService,
        ViewportTransform2D,
      ],
      this.environmentInjector,
    );
    const siteBridgeService = this.previewInjector.get(BridgeService);
    const cartoonRenderingService = this.previewInjector.get(CartoonRenderingService);
    const viewport = this.previewInjector.get(ViewportTransform2D);
    const bridge = this.bridgeService.bridge;
    siteBridgeService.setBridge(bridge, this.bridgeService.draftingPanelState);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    viewport.setViewport(0, height - 1, width - 1, 1 - height);
    viewport.setWindow(siteBridgeService.siteInfo.drawingWindow);
    cartoonRenderingService.options =
      CartoonOptionMask.ABUTMENTS |
      CartoonOptionMask.DECK |
      CartoonOptionMask.EXCAVATED_TERRAIN |
      CartoonOptionMask.IN_SITU_TERRAIN;
    cartoonRenderingService.render(ctx);

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgb(58, 64, 72)';
    for (const member of bridge.members) {
      // Shape widths are millimeters. Real widths vanish at thumbnail scale, so they only ever thicken the line.
      ctx.lineWidth = Math.max(2.5, viewport.worldToViewportDistance(member.shape.width / 1000));
      ctx.beginPath();
      ctx.moveTo(viewport.worldToViewportX(member.a.x), viewport.worldToViewportY(member.a.y));
      ctx.lineTo(viewport.worldToViewportX(member.b.x), viewport.worldToViewportY(member.b.y));
      ctx.stroke();
    }
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'white';
    for (const joint of bridge.joints) {
      ctx.beginPath();
      ctx.arc(viewport.worldToViewportX(joint.x), viewport.worldToViewportY(joint.y), 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
    return canvas.toDataURL('image/png');
  }

  /** Every entry runs inside the Angular zone so change detection sees what the host did. */
  private createApi() {
    const inZone = <T>(fn: () => T): T => this.zone.run(fn);
    return {
      ready: true,
      start: (text: string | null, name?: string) => inZone(() => this.start(text, name)),
      // Empty until the user has picked site conditions; a placeholder design can't be loaded back.
      getDesign: (): string =>
        this.bridgeService.designConditions === DesignConditionsService.PLACEHOLDER_CONDITIONS
          ? ''
          : this.bridgeService.saveSetText,
      isUnsaved: (): boolean => this.isUnsaved,
      // A PNG data URL, or empty before site conditions are chosen.
      getPreview: (width: number = 640, height: number = 400): string => this.renderPreview(width, height),
      markSaved: () => inZone(() => this.markStored()),
      onSave: (handler: (text: string) => unknown) => {
        this.saveHandler = handler;
      },
      onChange: (handler: (isUnsaved: boolean) => void) => {
        this.changeHandler = handler;
      },
    };
  }
}
