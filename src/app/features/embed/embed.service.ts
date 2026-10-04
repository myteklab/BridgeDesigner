/* Copyright (c) 2026 myteklab
   SPDX-License-Identifier: GPL-3.0-or-later */

import { Injectable, NgZone } from '@angular/core';
import { BridgeService } from '../../shared/services/bridge.service';
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

  constructor(
    private readonly bridgeService: BridgeService,
    private readonly eventBrokerService: EventBrokerService,
    private readonly persistenceService: PersistenceService,
    private readonly saveMarkService: SaveMarkService,
    private readonly zone: NgZone,
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
