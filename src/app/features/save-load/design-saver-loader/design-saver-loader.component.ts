/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */

import { AfterViewInit, ChangeDetectionStrategy, Component, Inject, ViewChild } from '@angular/core';
import {
  ButtonTag,
  ConfirmationDialogComponent,
} from '../../../shared/components/confirmation-dialog/confirmation-dialog.component';
import { SAVE_LOAD_PROVIDER_SPEC, SaveLoadService } from '../save-load.service';
import { EventBrokerService } from '../../../shared/services/event-broker.service';
import { EmbedService } from '../../embed/embed.service';
import { SaveMarkService } from '../save-mark.service';
import { InputDialogComponent } from '../../../shared/components/input-dialog/input-dialog.component';

@Component({
  selector: 'design-saver-loader',
  imports: [ConfirmationDialogComponent, InputDialogComponent],
  templateUrl: './design-saver-loader.component.html',
  styleUrl: './design-saver-loader.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [SAVE_LOAD_PROVIDER_SPEC],
})
export class DesignSaverLoaderComponent implements AfterViewInit {
  @ViewChild('saveBeforeLoadConfirmationDialog') saveBeforeLoadConfirmationDialog!: ConfirmationDialogComponent;
  @ViewChild('fileNameInputDialog') fileNameInputDialog!: InputDialogComponent;
  // What happens after the user clicks "yes" in the save before load confirmation.
  private loadFileContinuation: () => void;
  private readonly defaultLoadFileContinuation: () => void;

  constructor(
    private readonly embedService: EmbedService,
    private readonly eventBrokerService: EventBrokerService,
    @Inject('SaveLoadService') private readonly saveLoadService: SaveLoadService,
    private readonly saveMarkService: SaveMarkService,
  ) {
    this.loadFileContinuation = this.defaultLoadFileContinuation = async () => {
      await this.saveLoadService.loadBridgeFile();
    };
  }

  private async saveBridgeFileSafely(forceGetFile: boolean): Promise<void> {
    if (!forceGetFile && this.embedService.savesToHost) {
      this.embedService.saveToHost();
      return;
    }
    await this.saveLoadService.saveBridgeFile(forceGetFile, value => this.fileNameInputDialog.getInput(value));
  }

  private async loadBridgeFileSafely(continuation: (() => void) | undefined): Promise<void> {
    this.maybeSaveDirtyAndContinue(continuation ?? this.defaultLoadFileContinuation);
  }

  private maybeSaveDirtyAndContinue(continuation: () => void): void {
    if (this.saveMarkService.isDesignUnsaved) {
      this.loadFileContinuation = continuation;
      this.saveBeforeLoadConfirmationDialog.open();
    } else {
      continuation();
    }
  }

  async handleConfirmationButtonClick(button: ButtonTag): Promise<void> {
    switch (button) {
      case 'yes':
        await this.saveBridgeFileSafely(false);
        break;
      case 'cancel':
        return;
    }
    this.loadFileContinuation();
  }

  ngAfterViewInit(): void {
    this.eventBrokerService.saveBridgeFileRequest.subscribe(info => this.saveBridgeFileSafely(info.data));
    this.eventBrokerService.loadBridgeFileRequest.subscribe(info => this.loadBridgeFileSafely(info.data));
  }
}
