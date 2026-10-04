/* Copyright (c) 2025-2026 Gene Ressler
   SPDX-License-Identifier: GPL-3.0-or-later */

import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  QueryList,
  SimpleChanges,
  TemplateRef,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TopicNameDirective } from './topic-name.directive';
import { HelpTopicLinkComponent } from '../help-topic-link/help-topic-link.component';
import { HelpPopupTopicComponent } from '../help-topic-popup/help-topic-popup.component';
import { CurrentTopicService } from '../current-topic.service';
import { Utility } from '../../../shared/classes/utility';

@Component({
  selector: 'help-topic',
  imports: [CommonModule, HelpPopupTopicComponent, HelpTopicLinkComponent, TopicNameDirective],
  templateUrl: './help-topic.component.html',
  styleUrl: './help-topic.component.css',
})
export class HelpTopicComponent implements AfterViewInit, OnChanges {
  @Input() containerType: 'pane-content' | 'popup-content' = 'pane-content';
  @Input() visibleTopicId: string = CurrentTopicService.DEFAULT_TOPIC_ID;

  @ViewChild('defaultTopic', { static: true }) visibleTopic: TemplateRef<any> | null = null;
  @ViewChild('topicContainer') topicContainer!: ElementRef<HTMLDivElement>;

  @ViewChildren(TopicNameDirective) topicNames!: QueryList<TopicNameDirective>;

  constructor(private readonly currentTopicService: CurrentTopicService) {}

  /** Goes to specified topic. Called by links in component HTML. */
  goToTopic(topicId: string) {
    this.currentTopicService.goToTopicId(topicId);
  }

  private showTopic(topicId: string, scrollTop?: number): void {
    if (!this.topicNames) {
      return;
    }
    const directive = this.topicNames.find((directive, _index, _allNames) => directive.name === topicId);
    if (!directive) {
      return;
    }
    this.visibleTopicId = topicId;
    this.visibleTopic = directive.templateRef;
    if (scrollTop !== undefined) {
      setTimeout(() => {
        this.topicContainer.nativeElement.scrollTop = scrollTop;
      });
    }
  }

  private get scrollTop(): number {
    return this.topicContainer.nativeElement.scrollTop;
  }

  /**
   * Prints the div containing the current topic. Uses native window.print(),
   * not jsPDF, as that needs an additional library.
   */
  private printTopic(): void {
    // Copy topic to scratch window just for printing.
    const printWindow = Utility.assertNotNull(window.open());
    const printDoc = printWindow.document;
    printDoc.title = 'Bridge Designer Help';

    // Establish the base URL. Firefox needs a full path.
    const base = printDoc.createElement('base');
    const location = document.location;
    base.href = location.origin + location.pathname;
    printDoc.head.appendChild(base);

    // Copy all the style sheets.
    document.head.querySelectorAll('link[rel="stylesheet"], style').forEach(style => {
      printDoc.head.appendChild(style.cloneNode(true));
    });

    // Set up styles programmatically installed by jqWidgets.
    const style = printDoc.createElement('style');
    style.textContent = `
      body {
        font-family: Verdana, Arial, sans-serif;
        font-style: normal;
        font-size: 13px;
      }
      .popup-container {
        display: none !important;
      }`;
    printDoc.head.appendChild(style);

    // Copy the content as HTML.
    printDoc.body.outerHTML = this.topicContainer.nativeElement.outerHTML;

    // Wait for images to load then print.
    const imgPromises = Array.from(printDoc.images).map(
      img =>
        new Promise((resolve, reject) => {
          if (img.complete) {
            resolve(img);
          } else {
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Help image load failed'));
          }
        }),
    );
    Promise.all(imgPromises).then(() => {
      printWindow.print();
      printWindow.close();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['visibleTopicId'];
    if (change) {
      this.showTopic(change.currentValue);
    }
  }

  ngAfterViewInit(): void {
    this.showTopic(this.visibleTopicId);
    if (this.containerType === 'pane-content') {
      this.currentTopicService.scrollTopCallback = () => this.scrollTop;
      this.currentTopicService.currentTopicIdChange.subscribe(({ topicId, scrollTop }) => {
        this.showTopic(topicId, scrollTop);
      });
      this.currentTopicService.printCurrentTopicRequest.subscribe(() => this.printTopic());
    }
  }
}
