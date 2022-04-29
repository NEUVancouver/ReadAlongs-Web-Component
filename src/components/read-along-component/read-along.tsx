import { Component, Element, Listen, Prop, State, h } from '@stencil/core';
import { Alignment, Page, parseSMIL, getXML, parseTEIFromDoc } from '../../utils/utils'
import WaveSurfer from 'wavesurfer.js';
import MarkersPlugin from 'wavesurfer.js/dist/plugin/wavesurfer.markers'
import RegionsPlugin from 'wavesurfer.js/dist/plugin/wavesurfer.regions';
import Region from 'wavesurfer.js/src/plugin/regions';
import { InterfaceLanguage, returnTranslation } from './translation';

import palette from './palette';

const LOADING = 0;
const LOADED = 1;
const ERROR_LOADING = 2;
const MARKER_WIDTH = '11px';
const MARKER_HEIGHT = '22px';
const CONTEXT_MENU_ACTIVE = "context-menu--active";
const CONTEXT_MENU_LINK_CLASSNAME = "context-menu__link";
const CONTEXT_MENU_CLASSNAME = "context-menu";
const DARK_BACKGROUND = "#3c4369";
const LIGHT_BACKGROUND = '#FFFFFF';
const CONTEXT_MENU_ONE = 'context-menu--one';
const CONTEXT_MENU_TWO = 'context-menu--two';
const CONTEXT_MENU_HIDDEN = 'hidden';

export type ReadAlongMode = "READ-ONLY" | "ANCHOR" | "PREVIEW";
type AnchorInfo = { id: string, color: string, element: Element, time: number }

@Component({
  tag: 'read-along',
  styleUrl: '../../scss/styles.scss',
  shadow: true
})
export class ReadAlongComponent {
  @Element() el: HTMLElement;


  /************
   *  PROPS   *
   ************/

  /**
   * The text as TEI
   */
  @Prop({ mutable: true }) text: string;



  /**
   * The alignment as SMIL
   */
  @Prop({ mutable: true }) alignment: string;

  processed_alignment: Alignment;

  /**
   * The audio file
   */
  @Prop({ mutable: true }) audio: string;

  /**
   * Overlay
   * This is an SVG overlay to place over the progress bar
   */
  @Prop() svgOverlay: string;

  /**
   * Theme to use: ['light', 'dark'] defaults to 'dark'
   */
  @Prop({ mutable: true }) theme: string = 'light';

  /**
   * Language  of the interface. In 639-3 code
   * Options are
   * - "eng" for English
   * - "fra" for French
   */
  @Prop({ mutable: true }) language: InterfaceLanguage = 'eng';

  /**
   * Optional custom Stylesheet to override defaults
   */
  @Prop() cssUrl?: string;

  /**
   * Toggle the use of assets folder for resolving urls. Defaults to on
   * to maintain backwards compatibility
   */

  @Prop() useAssetsFolder: boolean = true;

  /**
   * Toggles the page scrolling from horizontal to vertical. Defaults to horizontal
   *
   */

  @Prop() pageScrolling: "horizontal" | "vertical" = "horizontal";
  /**
   * OPTIONAL
   */
  @Prop() mode: ReadAlongMode = "READ-ONLY";
  /************
   *  STATES  *
   ************/

  /**
   * Whether audio is playing or not
   */
  @State() playing: boolean = false;

  play_id: number;
  playback_rate: number = 1;

  @State() fullscreen: boolean = false;

  @State() autoScroll: boolean = true;
  @State() isLoaded: boolean = false;
  showGuide: boolean = false;

  @State() parsed_text;
  @State() anchorAlertMessage: { show: boolean, message: string } = { show: false, message: '' };

  current_page;
  hasTextTranslations: boolean = false;
  assetsStatus = {
    'AUDIO': LOADING,
    'XML': LOADING,
    'SMIL': LOADING
  };
  contextMenuElement: Element;
  wavesurfer: WaveSurfer;
  xmlDoc: Document;
  playingWord: HTMLElement;
  workingAnchorTime: number[];
  palette: string[];
  progressBarElement;
  allAnchors: { [id: string]: AnchorInfo };
  workingXmlDoc: Document;  // for storing temp anchor position of anchors outside sentence tags
  /************
   *  LISTENERS  *
   ************/

  @Listen('wheel', { target: 'window' })
  wheelHandler(event: MouseEvent): void {
    // only show guide if there is an actual highlighted element
    if (this.el.shadowRoot.querySelector('.reading')) {
      let path = event.composedPath();
      let first = path[0] as Element;
      if (first.classList.contains("sentence__word") ||
        first.classList.contains("sentence__container") ||
        first.classList.contains("sentence")) {
        if (this.autoScroll) {
          let reading_el: HTMLElement = this.el.shadowRoot.querySelector('.reading')
          if (reading_el) {
            this.autoScroll = !this.inPageContentOverflow(reading_el);
            this.showGuide = !this.autoScroll;
          }
        }
      }
    }
    this.toggleMenuOff();
  }

  @Listen('contextmenu', { target: 'window' })
  contextMenuHandler(e: PointerEvent): void {
    if (this.mode !== 'ANCHOR') {
      return;
    }
    let taskItemInContext: Element = this.lookupElement(e);
    this.contextMenuElement = taskItemInContext;

    //TODO manu on off fix
    if (!taskItemInContext) {
      this.toggleMenuOff();
      return;
    }
    e.preventDefault();
    this.toggleMenuOn(taskItemInContext, this.getPosition(e));

  }
  @Listen('keyup', { target: 'window' })
  keyUpHandler(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.toggleMenuOff();
    }
  }

  @Listen('resize', { target: 'window' })
  resizeHandler(): void {
    this.toggleMenuOff();
  }

  @Listen('click', { target: 'window' })
  clickHandler(e: MouseEvent): void {
    let hasContextMenuClicked = this.clickedInside(e, CONTEXT_MENU_LINK_CLASSNAME);
    if (!hasContextMenuClicked) {
      if (!this.clickedInside(e, CONTEXT_MENU_CLASSNAME)) {
        if (e.which === 1 || e.button === 1) {
          this.toggleMenuOff();
        }
      }
    }
  }

  /******************
   *  CONTEXT MENU  *
   ******************/
  /**
   * Hide the context menu
   */
  toggleMenuOff = () => {
    this.contextMenuElement = null;
    let menu: HTMLElement = this.el.shadowRoot.querySelector("#context-menu");
    menu.classList.remove(CONTEXT_MENU_ACTIVE);
    menu.classList.remove(CONTEXT_MENU_ONE)
    menu.classList.remove(CONTEXT_MENU_TWO)

  }
  /**
   * Show context menu
   * @param e  the word element the context menu shows for
   * @param x  the x coordinate of the context menu
   * @param y  the y coordinate of the context menu
   * @returns 
   */
  toggleMenuOn = (element: Element, { x: x, y: y }): void => {
    let id = element.id;



    let p = this.el.shadowRoot;
    let menu: HTMLElement = p.querySelector("#context-menu");
    let addAnchor: HTMLElement = p.querySelector('[data-action="add-anchor"]');
    let addAnchorAfter: HTMLElement = p.querySelector('[data-action="add-anchor-after"]');
    let delAnchor: HTMLElement = p.querySelector('[data-action="del-anchor"]');
    // if tagName === 'svg' or 'polygon', delete menu
    if (element.tagName === 'svg' || element.tagName === 'polygon') {
      id = element.id.substring(0, element.id.length - element.tagName.length - 1);
      if (!addAnchor.classList.contains(CONTEXT_MENU_HIDDEN)) {
        addAnchor.classList.add(CONTEXT_MENU_HIDDEN);
      }
      if (!addAnchorAfter.classList.contains(CONTEXT_MENU_HIDDEN)) {
        addAnchorAfter.classList.add(CONTEXT_MENU_HIDDEN);
      }

      delAnchor.classList.remove(CONTEXT_MENU_HIDDEN);
    } else {
      let xmlElement = this.workingXmlDoc.getElementById(id);
      let prev = this.getPreviousWordOrAnchor(xmlElement);
      let prevOfPrev = this.getPreviousWordOrAnchor(prev);
      let showBefore: boolean = !(prev && prev.tagName === 'anchor' && prevOfPrev && prevOfPrev.tagName === 'anchor');

      let showAfter: boolean = false;
      if (this.isLastWordOfParagraph(id)) {
        let next = this.getNextWordOrAnchor(xmlElement);
        let nextOfNext = this.getNextWordOrAnchor(next);

        showAfter = !(next && next.tagName === 'anchor' && nextOfNext && nextOfNext.tagName === 'anchor');
      }
      // cannot add anchor before nor after
      if (!showAfter && !showBefore) {
        return;
      }

      if (showBefore) {
        addAnchor.classList.remove(CONTEXT_MENU_HIDDEN);
      } else if (!addAnchor.classList.contains(CONTEXT_MENU_HIDDEN)) {
        addAnchor.classList.add(CONTEXT_MENU_HIDDEN)
      }
      if (showAfter) {
        addAnchorAfter.classList.remove(CONTEXT_MENU_HIDDEN);
      } else if (!addAnchorAfter.classList.contains(CONTEXT_MENU_HIDDEN)) {
        addAnchorAfter.classList.add(CONTEXT_MENU_HIDDEN);
      }
      if (showBefore && showAfter) {
        menu.classList.add(CONTEXT_MENU_TWO)
      } else {
        menu.classList.add(CONTEXT_MENU_ONE);
      }

      if (!delAnchor.classList.contains(CONTEXT_MENU_HIDDEN)) {
        delAnchor.classList.add(CONTEXT_MENU_HIDDEN);
      }
      this.workingAnchorTime = this.processed_alignment[id];
    }
    menu.classList.add(CONTEXT_MENU_ACTIVE);
    menu.setAttribute("data-id", id);

    this.positionMenu(x, y, "#context-menu");


  }

  /**
   * ANCHOR OPERATIONS
   */
  getAnchorId = (parentElementId: string) => {
    let i: number = 0;
    let id = `${parentElementId}anchor${i}`;
    while (this.allAnchors[id]) {
      id = `${parentElementId}anchor${++i}`;
    }
    return id;
  }
  insertAnchorAfter = (event: MouseEvent) => {
    this.insertAnchor(event, false);
  }
  insertAnchorBefore = (event: MouseEvent) => {
    this.insertAnchor(event, true);
  }
  insertAnchor = (event: MouseEvent, before: boolean) => {
    event.preventDefault();
    let menu: HTMLElement = this.el.shadowRoot.querySelector("#context-menu");
    let wordId: string = menu.getAttribute("data-id");

    let xmlDoc = this.xmlDoc;
    let wordElement = xmlDoc.getElementById(wordId);
    let anchorId = this.getAnchorId(wordElement.parentElement['id']);

    let color: string = this.palette.pop();
    let time = (before ? this.workingAnchorTime[0] : this.workingAnchorTime[0] + this.workingAnchorTime[1]) / 1000.0;
    // insert anchor as a marker in waveform 
    let anchor = this.wavesurfer.markers.add({
      time,
      label: "",
      color: color,
      draggable: true
    });
    anchor.id = anchorId;

    // insert anchor to XML
    let anchorNode = xmlDoc.createElement("anchor");
    anchorNode.setAttribute('id', anchorId);
    anchorNode.setAttribute('time', `${time.toFixed(2)}s`)
    this.allAnchors[anchorId] = { id: anchorId, color, element: anchorNode, time };

    // update working XML
    let workingAnchorNode = this.workingXmlDoc.createElement('anchor');
    workingAnchorNode.setAttribute('id', anchorId);
    workingAnchorNode.setAttribute('time', `${time.toFixed(2)}s`)
    let workingWordElement = this.workingXmlDoc.getElementById(wordId);

    if (before) {
      wordElement.parentElement.insertBefore(anchorNode, wordElement);
      workingWordElement.parentElement.insertBefore(workingAnchorNode, workingWordElement);
    } else {
      if (wordElement.nextSibling) {
        wordElement.parentElement.insertBefore(anchorNode, wordElement.nextSibling);
        workingWordElement.parentElement.insertBefore(workingAnchorNode, workingWordElement.nextSibling);
      } else {
        wordElement.parentElement.appendChild(anchorNode);
        workingWordElement.parentElement.appendChild(workingAnchorNode);
      }

    }

    // update parsed_text
    this.parsed_text = parseTEIFromDoc(this.workingXmlDoc);

    this.updateAnchorBackend();
    this.toggleMenuOff();
  }
  deleteAnchor = (event: MouseEvent) => {
    event.preventDefault();

    let menu: HTMLElement = this.el.shadowRoot.querySelector("#context-menu");
    let anchorId: string = menu.getAttribute("data-id");
    // Remove from waveForm
    let xmlDoc = this.xmlDoc;
    let anchorElement = xmlDoc.getElementById(anchorId);
    // remove node from xml
    anchorElement.parentElement.removeChild(anchorElement);

    // remove node from working XML Doc 
    let workingXmlDoc = this.workingXmlDoc;
    anchorElement = workingXmlDoc.getElementById(anchorId);
    anchorElement.parentElement.removeChild(anchorElement);

    // remove node from parsed_text
    this.parsed_text = parseTEIFromDoc(workingXmlDoc);

    // remove anchor from waveform
    let n = this.wavesurfer.markers.markers
      .findIndex(m => m.id === anchorId);
    this.wavesurfer.markers.remove(n);

    delete this.allAnchors[anchorId];

    this.updateAnchorBackend();
    this.toggleMenuOff();
  }

  updateAnchorBackend = () => {
    let fx = window['updateAnchor'];
    if (typeof (fx) !== 'function') {
      console.log('Invalid updateAnchor');
      return;
    }

    //convert to string
    let xmlString = new XMLSerializer().serializeToString(this.xmlDoc);
    // Replace the <w id="xxxxx"> and </w> since the make_dict.py will not accept this tag
    xmlString = xmlString.replace(/<w id="[a-z|0-9]*">/g, "")
    xmlString = xmlString.replace(/<\/w>/g, "")
    fx.call(this, xmlString);
  }

  closeAnchorAlert = (e: Event) => {
    e.preventDefault();
    this.anchorAlertMessage = { show: false, message: '' };
  }

  /**
   * Export the XML, SMIL and audio file as a bundle
   */
  exportPreview = (): void => {
    let fx = window["exportPreview"];
    if (typeof (fx) !== 'function') {
      console.log('Invalid exportPreview');
      return;
    }
    fx.call();
  }


  /***********
   *  UTILS  *
   ***********/
  positionMenu = (clickCoordsX: number, clickCoordsY: number, contextMenu: string) => {

    let menu: HTMLElement = this.el.shadowRoot.querySelector(contextMenu);
    let menuWidth = menu.offsetWidth + 4;
    let menuHeight = menu.offsetHeight + 4;

    let windowWidth = window.innerWidth;
    let windowHeight = window.innerHeight;
    if (windowWidth - clickCoordsX < menuWidth) {
      menu.style.left = windowWidth - menuWidth + "px";
    } else {
      menu.style.left = clickCoordsX + "px";
    }

    if (windowHeight - clickCoordsY < menuHeight) {
      menu.style.top = windowHeight - menuHeight + "px";
    } else {
      menu.style.top = clickCoordsY + "px";
    }
  }
  clickedInside = (e: Event, className: string): boolean => {
    let el = e.srcElement || e.target;
    let element: Element = (el as Element);

    if (element.classList.contains(className)) {
      return true;
    } else {
      while ((element = element.parentElement)) {
        if (element.classList && element.classList.contains(className)) {
          return true;
        }
      }
    }

    return false;
  }
  /**
   * Get the position of the mouse event
   * @returns the coordinate of the event
   */
  getPosition = (e: MouseEvent): { x: number, y: number } => {
    var posx = 0;
    var posy = 0;

    // if (!e) e =  window.event;
    if (!e) {
      return { x: 0, y: 0 };
    }

    if (e.pageX || e.pageY) {
      posx = e.pageX;
      posy = e.pageY;
    } else if (e.clientX || e.clientY) {
      posx =
        e.clientX +
        document.body.scrollLeft +
        document.documentElement.scrollLeft;
      posy =
        e.clientY +
        document.body.scrollTop +
        document.documentElement.scrollTop;
    }
    return {
      x: posx,
      y: posy,
    };
  }
  /**
   * Look up the element of the event
   * @param e The pointer Event
   * @returns The HTML Element 
   */
  lookupElement = (e: PointerEvent): Element => {
    let container = this.el.shadowRoot.querySelector("[data-cy=text-container]");

    if (this.isPointerEventInsideElement(e, container)) {

      // Check whether the tag have been selected
      let tagElements = container.querySelectorAll("svg");
      for (let i = 0; i < tagElements.length; i++) {
        if (this.isPointerEventInsideElement(e, tagElements[i])) {
          return tagElements[i];
        }
      }

      // Check whether the text have been selected
      let pages = container.querySelectorAll(".page");
      for (let i = 0; i < pages.length; i++) {
        if (this.isPointerEventInsideElement(e, pages[i])) {
          let paragraphs = pages[i].querySelectorAll(".page__col__text");
          for (let j = 0; j < paragraphs.length; j++) {
            if (this.isPointerEventInsideElement(e, paragraphs[j])) {
              let sentences = paragraphs[j].querySelectorAll(".sentence");
              for (let k = 0; k < sentences.length; k++) {
                if (this.isPointerEventInsideElement(e, sentences[k])) {
                  let words = sentences[k].querySelectorAll(".sentence__word");
                  for (let l = 0; l < words.length; l++) {
                    let word = words[l];
                    if (this.isPointerEventInsideElement(e, word)) {
                      return word;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  isPointerEventInsideElement = (event, element) => {
    var pos = {
      x:
        (event.targetTouches ? event.targetTouches[0].pageX : event.pageX) -
        scrollX,
      y:
        (event.targetTouches ? event.targetTouches[0].pageY : event.pageY) -
        scrollY,
    };
    var rect = element.getBoundingClientRect();
    return (
      pos.x < rect.right &&
      pos.x > rect.left &&
      pos.y < rect.bottom &&
      pos.y > rect.top
    );
  }

  /**
   * Transforms a given path to either use the default assets folder or rely on the absolute path given
   * @param path
   * @return string
   */
  private urlTransform(path: string): string {
    if (this.useAssetsFolder && looksLikeRelativePath(path))
      return "assets/" + path;
    return path;

    function looksLikeRelativePath(path: string): boolean {
      return !(/^(https?:[/]|assets)[/]\b/).test(path);
    }
  }



  /**
   * Add escape characters to query selector param
   * @param id
   */
  tagToQuery(id: string): string {
    id = id.replace(".", "\\.")
    id = id.replace("#", "\\#")
    return "#" + id
  }

  /**
   * Return HTML element of word closest to second s
   *
   * @param s seconds
   */
  returnWordClosestTo(s: number): HTMLElement {
    let keys = Object.keys(this.processed_alignment)
    // remove 'all' sprite as it's not a word.
    keys.pop()
    let t = s * 1000;
    let halfDuration = this.wavesurfer.getDuration() * 500;
    if (t < halfDuration) {
      for (let i = 0; i < keys.length; i++) {
        if (t > this.processed_alignment[keys[i]][0]
          && this.processed_alignment[keys[i + 1]]
          && t < this.processed_alignment[keys[i + 1]][0]) {
          return this.el.shadowRoot.querySelector(this.tagToQuery(keys[i]))
        }
      }
      if (t > this.processed_alignment[keys[keys.length - 1]][0]) {
        return this.el.shadowRoot.querySelector(this.tagToQuery(keys[keys.length - 1]));
      }
    } else {
      let i = keys.length - 1;
      // for the last word
      if (t > this.processed_alignment[keys[i]][0]) {
        return this.el.shadowRoot.querySelector(this.tagToQuery(keys[i]));
      }
      for (i = keys.length - 2; i >= 0; i--) {
        if (t > this.processed_alignment[keys[i]][0]
          && this.processed_alignment[keys[i + 1]]
          && t < this.processed_alignment[keys[i + 1]][0]) {
          return this.el.shadowRoot.querySelector(this.tagToQuery(keys[i]));
        }
      }
    }
  }

  getPreviousWordOrAnchor = (el: Element): Element => {
    if (!el) {
      return null;
    }
    let prev: Element = el.previousElementSibling;

    while (prev && prev.tagName !== 'w' && prev.tagName !== 'anchor') {
      let nodes = prev.querySelectorAll('w, anchor');
      if (nodes.length > 0) {
        return nodes.item(nodes.length - 1);
      }
      prev = prev.previousElementSibling;
    }
    if (prev) {
      return prev;
    }
    return this.getPreviousWordOrAnchor(el.parentElement);
  }

  getNextWordOrAnchor = (el: Element): Element => {
    if (!el) {
      return null;
    }
    let next = el.nextElementSibling;
    while (next && next.tagName !== 'w' && next.tagName !== 'anchor') {
      // look for next's children
      let nodes = next.getElementsByTagName('w, anchor');
      if (nodes.length > 0) {
        return nodes.item(0);
      }
      next = next.nextElementSibling;
    }
    if (next) {
      return next;
    }
    return this.getNextWordOrAnchor(el.parentElement);
  }

  /**
   * determine whether it is the last word of a paragraph
   * @param wordId the word element id
   * @returns true if the word is the last word of a paragraph
   */
  isLastWordOfParagraph = (wordId: string) => {
    let lastWords = this.xmlDoc.querySelectorAll('s:last-child w:last-of-type');
    for (let i = 0; i < lastWords.length; i++) {
      if (lastWords.item(i).id === wordId) {
        return true;
      }
    }
    return false;
  }


  /*************
   *   AUDIO   *
   *************/

  /**
   * Change playback between .75 and 1.25. To change the playback options,
   * change the HTML in the function renderControlPanel
   *
   * @param ev
   */
  changePlayback = (ev: Event): void => {
    let inputEl = ev.currentTarget as HTMLInputElement
    this.playback_rate = parseInt(inputEl.value) / 100
    this.wavesurfer.setPlaybackRate(this.playback_rate);
  }

  /**
   *  Go back s milliseconds
   *
   * @param s
   */

  goBack = (s: number): void => {
    this.wavesurfer.skipBackward(s);
  }

  /**
   * Go to seek
   *
   * @param seek number in millisecond
   *
   */
  goTo(seek: number): void {
    if (this.play_id === undefined) {
      this.playPause();
      this.playPause();
    }
    this.autoScroll = false;
    seek = seek / 1000
    // this.audio_howl_sprites.goTo(this.play_id, seek)
    this.wavesurfer.setCurrentTime(seek);
    setTimeout(() => this.autoScroll = true, 100)
  }


  /**
   * Go to seek from progress bar
   */
  goToSeekFromProgress(ev: MouseEvent): void {
    let el = ev.currentTarget as HTMLElement;
    let client_rect = el.getBoundingClientRect()
    // get offset of clicked element
    let offset = client_rect.left
    // get width of clicked element
    let width = client_rect.width
    // get click point
    let click = ev.pageX - offset
    // get seek in milliseconds
    let seek = ((click / width) * this.wavesurfer.getDuration()) * 1000

    this.goTo(seek)
  }

  /**
   * 
   */
  playPause = () => {
    this.wavesurfer.playPause();
    this.playing = this.wavesurfer.isPlaying();
  }

  playRegion = () => {
    let region: Region;
    region = Object.values(this.wavesurfer.regions.list)[0];
    if (region) {
      region.play();
      this.playing = this.wavesurfer.isPlaying();
    }
    else {
      alert("There is no region selected");
    }
  }

  deleteRegion = () => {
    this.wavesurfer.regions.clear();
  }

  /**
   * Seek to an element with id 'id', then play it
   *
   * @param ev
   */
  playSprite = (ev: MouseEvent): void => {
    let wordEl = ev.currentTarget as HTMLElement;
    let [start, length]: number[] = this.processed_alignment[wordEl.id];
    let s = start / 1000.0;
    this.wavesurfer.setCurrentTime(s);
    this.addHighlightingTo(wordEl);
    this.playingWord = wordEl;
    this.wavesurfer.play(s, s + length / 1000.0);
  }


  /**
   * Stop the sound and remove all active reading styling
   */
  stop = () => {
    if (this.wavesurfer.isPlaying()) {
      this.playPause();
    }
    this.wavesurfer.stop();
    this.el.shadowRoot.querySelectorAll(".reading").forEach(x => x.classList.remove('reading'));

    if (this.progressBarElement) {
      this.progressBarElement.setAttribute('offset', '0%');
      this.progressBarElement.style.width = '0%';
    }
  }

  createWaveSurfer = () => {
    let wavesurfer = WaveSurfer.create({
      container: this.el.shadowRoot.querySelector("#wave"),
      waveColor: "#A8DBA8",
      progressColor: "#3B8686",
      backgroundColor: this.theme == 'light' ? LIGHT_BACKGROUND : DARK_BACKGROUND,
      backend: "MediaElement",
      responsive: true,
      plugins: [
        RegionsPlugin.create({
          regions: [],
          dragSelection: {
            slop: 5,
          },
          maxRegions: 1
        }),
        MarkersPlugin.create({
          markers: [
            // Need to create dummy marker in order to support draggable
            {
              id: "dummy",
              time: -1,
              label: "",
              position: "top",
              color: "#ffaa11",
              draggable: true,
            },
          ],
        }),

      ],
    });

    try {
      wavesurfer.load(this.audio);
    } catch (e) {
      console.log(e)
      this.isLoaded = true;
      this.assetsStatus.AUDIO = ERROR_LOADING;
    }

    // Disable the region click event as we use Seek method to control the audio
    wavesurfer.setDisabledEventEmissions("region-click");

    // After an anchor is dragged
    wavesurfer.on("marker-drop", (marker) => {
      let all = this.allAnchors;
      let maxTimeBefore: number = 0;
      let minTimeAfter: number = this.wavesurfer.getDuration() + 999;
      let originalTime = all[marker.id].time;
      for (let id in all) {
        if (id === marker.id) {
          continue;
        }
        let t = all[id].time;
        if (t < originalTime && t > maxTimeBefore) {
          maxTimeBefore = t;
        } else if (t > originalTime && t < minTimeAfter) {
          minTimeAfter = t;
        }
      }
      // if updated anchor is still in order, do nothing
      if (maxTimeBefore < marker.time && marker.time < minTimeAfter) {
        all[marker.id].element.setAttribute('time', `${marker.time.toFixed(2)}s`)
        this.updateAnchorBackend();
        return;
      }
      // updated anchor is out of order
      // remove anchor from waveform
      let n = this.wavesurfer.markers.markers
        .findIndex(m => m.id === marker.id);
      this.wavesurfer.markers.remove(n);
      // add another anchor
      let newAnchor = this.wavesurfer.markers.add({
        time: originalTime,
        label: '',
        color: marker.color,
        draggable: true
      });
      newAnchor.id = marker.id;

      this.anchorAlertMessage = { show: true, message: 'Invalid anchor location' };

    });



    wavesurfer.on('ready', () => {
      // create anchors
      for (let id in this.allAnchors) {
        let anchorInfo: AnchorInfo = this.allAnchors[id];
        let anchor = this.wavesurfer.markers.add({
          time: anchorInfo.time,
          label: "",
          color: anchorInfo.color,
          draggable: true
        });
        anchor.id = id;
      }

      this.isLoaded = true;
      this.assetsStatus.AUDIO = LOADED;
      this.processed_alignment['all'] = [0, this.wavesurfer.getDuration() * 1000];
    });

    wavesurfer.on('error', (err) => {
      console.log(err)
      this.isLoaded = true;
      this.assetsStatus.AUDIO = ERROR_LOADING;
    })

    wavesurfer.on('audioprocess', () => {
      let el: HTMLElement = this.returnWordClosestTo(this.wavesurfer.getCurrentTime());
      if (el && (!this.playingWord || this.playingWord !== el)) {
        this.addHighlightingTo(el);
        this.playingWord = el;

      }
      if (this.progressBarElement) {
        let percent = `${this.wavesurfer.getCurrentTime() / this.wavesurfer.getDuration() * 100}%`;
        this.progressBarElement.setAttribute('offset', percent);
        this.progressBarElement.style.width = percent;
      }


    });
    wavesurfer.on('seek', (progress) => {
      let time = progress * this.wavesurfer.getDuration();
      let el: HTMLElement = this.returnWordClosestTo(time);
      if (el) {
        this.addHighlightingTo(el);

      }
      if (!this.progressBarElement) {
        this.animateProgress();
      }
      this.progressBarElement.setAttribute('offset', `${progress * 100}%`);
      this.progressBarElement.style.width = `${progress * 100}%`;

    });

    wavesurfer.on('pause', () => {
      this.playing = false;
      this.el.shadowRoot.querySelectorAll(".reading").forEach(x => x.classList.remove('reading'));
    })
    wavesurfer.on('finish', () => {
      this.stop();
      this.playing = false;
    })

    this.wavesurfer = wavesurfer;
  }

  /**
   * toggle the visibility of translation text
   */
  toggleTextTranslation(): void {
    this.el.shadowRoot.querySelectorAll('.translation').forEach(translation => translation.classList.toggle('invisible'))
    this.el.shadowRoot.querySelectorAll('.sentence__translation').forEach(translation => translation.classList.toggle('invisible'))

  }

  /*************
   * ANIMATION *
   *************/

  /**
   * Remove highlighting from every other word and add it to el
   *
   * @param el
   */
  addHighlightingTo(el: HTMLElement): void {
    this.el.shadowRoot.querySelectorAll(".reading").forEach(x => x.classList.remove('reading'));
    el.classList.add('reading')

    // Scroll horizontally (to different page) if needed
    let current_page = ReadAlongComponent._getSentenceContainerOfWord(el).parentElement.id

    if (current_page !== this.current_page) {
      if (this.current_page !== undefined) {
        this.scrollToPage(current_page)
      }
      this.current_page = current_page
    }

    //if the user has scrolled away from the from the current page bring them page
    if (el.getBoundingClientRect().left < 0 || this.el.shadowRoot.querySelector("#" + current_page).getBoundingClientRect().left !== 0) {
      this.scrollToPage(current_page)
    }

    // scroll vertically (through paragraph) if needed
    if (this.inPageContentOverflow(el)) {
      if (this.autoScroll) {
        el.scrollIntoView(false);
        this.scrollByHeight(el)
      }
    }// scroll horizontal (through paragraph) if needed
    if (this.inParagraphContentOverflow(el)) {
      if (this.autoScroll) {
        el.scrollIntoView(false);
        this.scrollByWidth(el)
      }
    }
  }

  /**
  * Animate the progress through the overlay svg
  */
  animateProgressWithOverlay(): void {
    // select svg container
    let wave__container: any = this.el.shadowRoot.querySelector('#overlay__object')
    // use svg container to grab fill and trail
    let fill: HTMLElement = wave__container.contentDocument.querySelector('#progress-fill')
    // let trail = wave__container.contentDocument.querySelector('#progress-trail')
    let base = wave__container.contentDocument.querySelector('#progress-base')
    fill.classList.add('stop-color--' + this.theme)
    base.classList.add('stop-color--' + this.theme)

    // // push them to array to be changed in step()
    // this.audio_howl_sprites.sounds.push(fill)
    // this.audio_howl_sprites.sounds.push(trail)
    // // When this sound is finished, remove the progress element.
    // this.audio_howl_sprites.sound.once('end', () => {
    //   this.audio_howl_sprites.sounds.forEach(x => {
    //     x.setAttribute("offset", '0%');
    //   });
    //   this.el.shadowRoot.querySelectorAll(".reading").forEach(x => x.classList.remove('reading'))
    //   this.playing = false;
    //   // }
    // }, this.play_id);
  }

  /**
   * Animate the progress if no svg overlay is provided
   *
   * @param tag
   */
  animateProgressDefault(tag: string): void {
    if (this.progressBarElement) {
      return;
    }
    let elm = document.createElement('div');
    elm.className = 'progress theme--' + this.theme;
    // elm.id = play_id.toString();

    elm.dataset.sprite = tag;
    let query = this.tagToQuery(tag);
    this.el.shadowRoot.querySelector(query).appendChild(elm);
    this.progressBarElement = elm;

  }

  /**
   * Animate progress, either by default or with svg overlay.
   */
  animateProgress(): void {
    // Start animating progress
    if (this.svgOverlay) {
      // either with svg overlay
      this.animateProgressWithOverlay();
    } else {
      // or default progress bar
      this.animateProgressDefault('all');
    }
  }

  /**
   * Change fill colour to match theme
   */
  changeFill(): void {
    // Get theme contrast from the computed color of a word
    let contrast_el = this.el.shadowRoot.querySelector('.sentence__word')
    let contrast = window.getComputedStyle(contrast_el).color

    // select svg container
    let wave__container: any = this.el.shadowRoot.querySelector('#overlay__object')

    // use svg container to grab fill and trail
    let fill = wave__container.contentDocument.querySelector('#progress-fill')
    let base = wave__container.contentDocument.querySelector('#progress-base')

    // select polygon
    let polygon = wave__container.contentDocument.querySelector('#polygon')
    polygon.setAttribute('stroke', contrast)

    base.setAttribute('stop-color', contrast)
    fill.setAttribute('stop-color', contrast)
  }

  /**
   * Change theme
   */
  changeTheme = (): void => {
    if (this.theme === 'light') {
      this.theme = 'dark'
      this.wavesurfer.setBackgroundColor(DARK_BACKGROUND);
    } else {
      this.theme = 'light'
      this.wavesurfer.setBackgroundColor(LIGHT_BACKGROUND);
    }
  }

  /**
   * Return the Sentence Container of Word
   * Currently the 3rd parent up the tree node
   * @param element
   * @private
   */
  private static _getSentenceContainerOfWord(element: HTMLElement): HTMLElement {
    return element.parentElement.parentElement.parentElement
  }

  /**
   * Make Fullscreen
   */
  private toggleFullscreen(): void {
    if (!this.fullscreen) {
      let elem: any = this.el.shadowRoot.getElementById('read-along-container');
      if (elem.requestFullscreen) {
        elem.requestFullscreen();
      } else if (elem.mozRequestFullScreen) { /* Firefox */
        elem.mozRequestFullScreen();
      } else if (elem.webkitRequestFullscreen) { /* Chrome, Safari and Opera */
        elem.webkitRequestFullscreen();
      } else if (elem.msRequestFullscreen) { /* IE/Edge */
        elem.msRequestFullscreen();
      }
      this.el.shadowRoot.getElementById('read-along-container')
        .classList.add('read-along-container--fullscreen');
    } else {
      let document: any = this.el.ownerDocument
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.mozCancelFullScreen) { /* Firefox */
        document.mozCancelFullScreen();
      } else if (document.webkitExitFullscreen) { /* Chrome, Safari and Opera */
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) { /* IE/Edge */
        document.msExitFullscreen();
      }
      this.el.shadowRoot.getElementById('read-along-container')
        .classList.remove('read-along-container--fullscreen');
    }
    this.fullscreen = !this.fullscreen
  }

  /*************
   * SCROLLING *
   *************/

  hideGuideAndScroll(): void {
    let reading_el: HTMLElement = this.el.shadowRoot.querySelector('.reading')
    // observe when element is scrolled to, then remove the scroll guide and unobserve
    let intersectionObserver = new IntersectionObserver((entries) => {
      let [entry] = entries;
      if (entry.isIntersecting) {
        setTimeout(() => {
          this.showGuide = false;
          this.autoScroll = true
        }, 100)
        intersectionObserver.unobserve(reading_el)
      }
    })
    intersectionObserver.observe(reading_el)
    this.scrollTo(reading_el)
  }

  //for when you visually align content
  inParagraphContentOverflow(element: HTMLElement): boolean {
    let para_el = ReadAlongComponent._getSentenceContainerOfWord(element);
    let para_rect = para_el.getBoundingClientRect()
    let el_rect = element.getBoundingClientRect()

    // element being read is left of the words being viewed
    let inOverflowLeft = el_rect.right < para_rect.left;
    // element being read is right of the words being viewed
    let inOverflowRight = el_rect.right > para_rect.right;

    let intersectionObserver = new IntersectionObserver((entries) => {
      let [entry] = entries;
      if (entry.isIntersecting) {
        setTimeout(() => {
          this.showGuide = false;
          this.autoScroll = true
        }, 100)
        intersectionObserver.unobserve(element)
      }
    })
    intersectionObserver.observe(element)
    // if not in overflow, return false
    return (inOverflowLeft || inOverflowRight)
  }

  inPageContentOverflow(element: HTMLElement): boolean {
    let page_el = this.el.shadowRoot.querySelector('#' + this.current_page)
    let page_rect = page_el.getBoundingClientRect()
    let el_rect = element.getBoundingClientRect()

    // element being read is below/ahead of the words being viewed
    let inOverflowBelow = el_rect.top + el_rect.height > page_rect.top + page_rect.height
    // element being read is above/behind of the words being viewed
    let inOverflowAbove = el_rect.top + el_rect.height < 0

    let intersectionObserver = new IntersectionObserver((entries) => {
      let [entry] = entries;
      if (entry.isIntersecting) {
        setTimeout(() => {
          this.showGuide = false;
          this.autoScroll = true
        }, 100)
        intersectionObserver.unobserve(element)
      }
    })
    intersectionObserver.observe(element)

    // if not in overflow, return false
    return (inOverflowAbove || inOverflowBelow)
  }

  inPage(element: HTMLElement): boolean {
    let sent_el = ReadAlongComponent._getSentenceContainerOfWord(element)
    let sent_rect = sent_el.getBoundingClientRect()
    let el_rect = element.getBoundingClientRect()
    // element being read is below/ahead of the words being viewed
    let inOverflowBelow = el_rect.top + el_rect.height > sent_rect.top + sent_rect.height
    // element being read is above/behind of the words being viewed
    let inOverflowAbove = el_rect.top + el_rect.height < 0


    let intersectionObserver = new IntersectionObserver((entries) => {
      let [entry] = entries;
      if (entry.isIntersecting) {
        setTimeout(() => {
          this.showGuide = false;
          this.autoScroll = true
        }, 100)
        intersectionObserver.unobserve(element)
      }
    })
    intersectionObserver.observe(element)

    // if not in overflow, return false
    return (inOverflowAbove || inOverflowBelow)
  }

  scrollToPage(pg_id: string): void {
    let page_container: any = this.el.shadowRoot.querySelector('.pages__container')
    let next_page: any = this.el.shadowRoot.querySelector('#' + pg_id)
    page_container.scrollBy({
      top: this.pageScrolling.match("vertical") != null ? (next_page.offsetTop - page_container.scrollTop) : 0,
      left: this.pageScrolling.match("vertical") != null ? 0 : (next_page.offsetLeft - page_container.scrollLeft),
      behavior: 'smooth'
    });
    next_page.scrollTo(0, 0)//reset to top of the page
  }

  scrollByHeight(el: HTMLElement): void {

    let sent_container = ReadAlongComponent._getSentenceContainerOfWord(el) //get the direct parent sentence container


    let anchor = el.parentElement.getBoundingClientRect()
    sent_container.scrollBy({
      top: sent_container.getBoundingClientRect().height - anchor.height, // negative value acceptable
      left: 0,
      behavior: 'smooth'
    })

  }

  //scrolling within the visually aligned paragraph
  scrollByWidth(el: HTMLElement): void {

    let sent_container = ReadAlongComponent._getSentenceContainerOfWord(el) //get the direct parent sentence container


    let anchor = el.getBoundingClientRect()
    sent_container.scrollTo({
      left: anchor.left - 10, // negative value acceptable
      top: 0,
      behavior: 'smooth'
    })

  }

  scrollTo(el: HTMLElement): void {

    el.scrollIntoView({
      behavior: 'smooth'
    });
  }



  /*************
   * LIFECYCLE *
   *************/

  /**
   * When the component updates, change the fill of the progress bar.
   * This is because the fill colour is determined by a computed CSS
   * value set by the Web Component's theme. When the @prop theme changes and
   * the component updates, we have to update the fill with the new
   * computed CSS value.
   */
  componentDidUpdate() {
    if (this.svgOverlay) {
      this.changeFill()
    }
  }

  /**
   * Using this Lifecycle hook to handle backwards compatibility of component attribute
   */
  componentWillLoad() {
    // The backward compatible behaviour used to be audio, alignment and text files outside assets
    // and only image files inside assets.
    // See version 0.1.0, where it only looks in assets/ for images, nothing else.
    // TO maintain backwards compatibility handle assets url
    //this.audio = this.urlTransform(this.audio)
    //this.alignment = this.urlTransform(this.alignment)
    //this.text = this.urlTransform(this.text)
    //this.cssUrl = this.urlTransform(this.cssUrl)

    // TO maintain backwards compatibility language code
    if (this.language.length < 3) {
      if (this.language.match("fr") != null) {
        this.language = "fra"
      } else {
        this.language = "eng"
      }
    }
    //process XML
    let xmlText = getXML(this.text)
    this.xmlDoc = new DOMParser().parseFromString(xmlText, 'text/xml');
    let tempXmlDoc = new DOMParser().parseFromString(xmlText, 'text/xml');
    this.workingXmlDoc = tempXmlDoc;
    let wordsAnchors = tempXmlDoc.querySelectorAll('w,anchor');

    this.palette = palette.slice();
    this.allAnchors = {};
    // find existing anchors

    for (let i = 0; i < wordsAnchors.length; i++) {
      let n = wordsAnchors.item(i);
      if (n.tagName !== 'anchor') {
        continue;
      }
      let anchor = tempXmlDoc.getElementById(n.id);
      let timeStr = anchor.getAttribute('time');
      let time = 0;
      if (timeStr.endsWith('ms')) {
        time = Number(timeStr.substring(0, timeStr.length - 2)) / 1000.0;
      } else if (timeStr.endsWith('s')) {
        time = Number(timeStr.substring(0, timeStr.length - 1));
      }
      let id = n.id;
      this.allAnchors[id] = { id: id, color: this.palette.pop(), element: anchor, time };

      if (anchor.parentElement && anchor.parentElement.tagName === 's') {
        // anchor already under a sentence
        continue;
      }
      if (anchor.nextElementSibling) {
        // get next word
        let word: Element = null;
        for (let j = i + 1; j < wordsAnchors.length; j++) {
          if (wordsAnchors[j].tagName === 'w') {
            word = wordsAnchors[j];
            break;
          }
        }
        if (word) {
          // insert anchor before this word
          let w = tempXmlDoc.getElementById(word.id);
          w.parentElement.insertBefore(anchor, w);
          continue;
        }
      }
      if (anchor.previousElementSibling) {
        // get previous word
        let word: Element = null;
        for (let j = i - 1; j >= 0; j--) {
          if (wordsAnchors[j].tagName === 'w') {
            word = wordsAnchors[j];
            break;
          }
        }
        if (word) {
          // insert anchor after this word
          let w = tempXmlDoc.getElementById(word.id);
          w.parentElement.appendChild(anchor);
        }
      }
    }

    this.parsed_text = parseTEIFromDoc(tempXmlDoc);

    if (this.mode === 'ANCHOR') {
      // update the original version
      this.updateAnchorBackend();
    }

    this.assetsStatus.XML = this.parsed_text.length ? LOADED : ERROR_LOADING;
    this.processed_alignment = parseSMIL(this.alignment);
    this.assetsStatus.SMIL = Object.keys(this.processed_alignment).length ? LOADED : ERROR_LOADING;
  }

  /**
   * Lifecycle hook: after component loads, build the Sprite and parse the files necessary.
   * Then subscribe to the _reading$ Subject in order to update CSS styles when new element
   * is being read
   */
  componentDidLoad() {

    this.processed_alignment = parseSMIL(this.alignment)
    this.assetsStatus.SMIL = Object.keys(this.processed_alignment).length ? LOADED : ERROR_LOADING

    this.createWaveSurfer();

  }



  /**********
   * RENDER *
   **********/

  /**
   * The Guide element
   */
  Guide = (): Element =>
    <button class={'scroll-guide__container ripple ui-button theme--' + this.theme}
      onClick={() => this.hideGuideAndScroll()}>
      <span class={'scroll-guide__text theme--' + this.theme}>
        {returnTranslation('re-align', this.language)}
      </span>
    </button>

  /**
   * Render svg overlay
   */
  Overlay = (): Element => <object onClick={(e) => this.goToSeekFromProgress(e)} id='overlay__object'
    type='image/svg+xml' data={this.svgOverlay} />

  /**
   * Render image at path 'url' in assets folder.
   *
   * @param props
   */
  Img = (props: { url: string }): Element => {


    return (<div class={"image__container page__col__image theme--" + this.theme}>
      <img alt={"image"} class="image" src={this.urlTransform(props.url)} />
    </div>)
  }


  /**
   * Page Counter element
   *
   * @param props
   *
   * Shows currentPage / pgCount
   */
  PageCount = (props: { pgCount: number, currentPage: number }): Element =>
    <div class={"page__counter color--" + this.theme}>
      Page
      {' '}
      <span data-cy="page-count__current">{props.currentPage}</span>
      {' / '}
      <span data-cy="page-count__total">{props.pgCount}</span>
    </div>

  /**
   * Page element
   *
   * @param props
   *
   * Show 'Page' or vertically scrollable text content.
   * Text content on 'Page' breaks is separated horizontally.
   */
  Page = (props: { pageData: Page }): Element =>
    <div
      class={'page page__container page--multi animate-transition  theme--' + this.theme + " " + (props.pageData.attributes["class"] ? props.pageData.attributes["class"].value : "")}
      id={props.pageData['id']}>
      { /* Display the PageCount only if there's more than 1 page */
        this.parsed_text.length > 1 ? <this.PageCount pgCount={this.parsed_text.length}
          currentPage={this.parsed_text.indexOf(props.pageData) + 1} /> : null
      }
      { /* Display an Img if it exists on the page */
        props.pageData.img ? <this.Img url={props.pageData.img} /> : null
      }
      <div class={"page__col__text paragraph__container theme--" + this.theme}>
        { /* Here are the Paragraph children */
          props.pageData.paragraphs.map((paragraph: Element) => {

            return <this.Paragraph sentences={Array.from(paragraph.childNodes)} attributes={paragraph.attributes} />
          }
          )
        }
      </div>
    </div>

  /**
   * Paragraph element
   *
   * @param props
   *
   * A paragraph element with one or more sentences
   */
  Paragraph = (props: { sentences: Node[], attributes: NamedNodeMap }): Element =>
    <div
      class={'paragraph sentence__container theme--' + this.theme + " " + (props.attributes["class"] ? props.attributes["class"].value : "")}>
      {
        /* Here are the Sentence children */
        props.sentences.map((sentence: Element) =>
          (sentence.childNodes.length > 0) &&
          <this.Sentence words={Array.from(sentence.childNodes)} attributes={sentence.attributes} />)
      }
    </div>

  /**
   * Sentence element
   *
   * @param props
   *
   * A sentence element with one or more words
   */
  Sentence = (props: { words: Node[], attributes: NamedNodeMap }): Element => {
    if (!this.hasTextTranslations && props.attributes["class"]) {
      this.hasTextTranslations = props.attributes["class"].value.match("translation") != null;
    }
    let nodeProps = {};
    if (props.attributes && props.attributes['xml:lang']) {

      nodeProps['lang'] = props.attributes['xml:lang'].value
    }
    if (props.attributes && props.attributes['lang']) {

      nodeProps['lang'] = props.attributes['lang'].value
    }

    return <div {...nodeProps}
      class={'sentence' + " " + (props.attributes["class"] ? props.attributes["class"].value : "")}>
      {
        /* Here are the Word and NonWordText children */
        props.words.map((child: Element, c) => {

          if (child.nodeName === '#text') {
            return <this.NonWordText text={child.textContent} attributes={child.attributes}
              id={(props.attributes["id"] ? props.attributes["id"].value : "P") + 'text' + c} />
          } else if (child.nodeName === 'w') {
            return <this.Word text={child.textContent} id={child['id']} attributes={child.attributes} />
          } else if (child.nodeName === 'anchor') {
            if (this.mode !== 'ANCHOR') {
              return null;
            }
            let color: string = this.allAnchors[child['id']].color;
            return <this.Anchor id={child['id']} color={color} />
          } else if (child) {
            let cnodeProps = {};
            if (child.attributes['xml:lang']) cnodeProps['lang'] = props.attributes['xml:lang'].value
            if (child.attributes['lang']) cnodeProps['lang'] = props.attributes['lang'].value
            return <span {...cnodeProps} class={'sentence__text theme--' + this.theme + (' ' + child.className)}
              id={child.id ? child.id : 'text_' + c}>{child.textContent}</span>
          }
        })
      }
    </div>
  }

  /**
   * A non-Word text element
   *
   * @param props
   *
   * This is an element that is a child to a Sentence element,
   * but cannot be clicked and is not a word. This is usually
   * inter-Word punctuation or other text.
   */
  NonWordText = (props: { text: string, id: string, attributes: NamedNodeMap }): Element => {
    let nodeProps = {};
    if (props.attributes && props.attributes['xml:lang']) nodeProps['lang'] = props.attributes['xml:lang'].value
    if (props.attributes && props.attributes['lang']) nodeProps['lang'] = props.attributes['lang'].value

    return <span {...nodeProps} class={'sentence__text theme--' + this.theme} id={props.id}>{props.text}</span>
  }

  /**
    * Anchor element
    * 
    * @param props id - the id of the anchor, color: color of the anchor
    * @returns an svg representing an anchor
    */
  Anchor = (props: { id: string, color: string }): Element => {
    return <svg viewBox='0 0 40 80' id={`${props.id}-svg`} style={{
      width: MARKER_WIDTH, height: MARKER_HEIGHT, minWidth: MARKER_WIDTH, marginRight: '5px',
      zIndex: '4', cursor: 'pointer'
    }}>
      <polygon id={`${props.id}-polygon`} stroke='#979797' fill={props.color} points='20 0 40 30 40 80 0 80 0 30'>
      </polygon></svg>
  }

  /**
   * A Word text element
   *
   * @param props
   *
   * This is a clickable, audio-aligned Word element
   */
  Word = (props: { id: string, text: string, attributes: NamedNodeMap }): Element => {
    let nodeProps = {};
    if (props.attributes && props.attributes['xml:lang']) nodeProps['lang'] = props.attributes['xml:lang'].value
    if (props.attributes && props.attributes['lang']) nodeProps['lang'] = props.attributes['lang'].value

    return <span {...nodeProps}
      class={'sentence__word theme--' + this.theme + " " + (props && props.attributes["class"] ? props.attributes["class"].value : "")}
      id={props.id} onClick={this.playSprite}>{props.text}</span>
  }
  /**
   * Render controls for ReadAlong
   */

  PlayControl = (): Element => <button data-cy="play-button" disabled={!this.isLoaded} aria-label="Play"
    onClick={this.playPause}
    class={"tooltip control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons">{this.wavesurfer.isPlaying() ? 'pause' : 'play_arrow'}</i>
    <span class="tooltiptext">{this.wavesurfer.isPlaying() ? 'Pause' : 'Play'}</span>
  </button>

  ReplayControl = (): Element => <button data-cy="replay-button" disabled={!this.isLoaded} aria-label="Rewind"
    onClick={() => this.goBack(5)}
    class={"tooltip control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons">replay_5</i>
    <span class="tooltiptext">Rewind</span>
  </button>

  StopControl = (): Element => <button data-cy="stop-button" disabled={!this.isLoaded} aria-label="Stop"
    onClick={this.stop}
    class={"tooltip control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons">stop</i>
    <span class="tooltiptext">Stop</span>
  </button>

  ExportPreviewControl = (): Element => <button data-cy="export-original-button" aria-label="Export Preview"
    onClick={this.exportPreview}
    class={"tooltip control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons-outlined">file_download</i>
    <span class="tooltiptext">Export the readalong preview version</span>
  </button>

  PlayReginControl = (): Element => <button data-cy="export-original-button" aria-label="Export Preview"
    onClick={this.playRegion}
    class={"tooltip control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons">play_circle</i>
    <span class="tooltiptext">Play selected region</span>
  </button>
  DeleteReginControl = (): Element => <button data-cy="export-original-button" aria-label="Export Preview"
    onClick={this.deleteRegion}
    class={"tooltip control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons-outlined">
      highlight_off
    </i>
    <span class="tooltiptext">Delete region</span>
  </button>
  PlaybackSpeedControl = (): Element => <div>
    <h5
      class={"control-panel__buttons__header color--" + this.theme}>{returnTranslation('speed', this.language)}</h5>
    <input type="range" min="75" max="125" value={this.playback_rate * 100} class="slider control-panel__control"
      id="myRange" onInput={(v) => this.changePlayback(v)} />
  </div>

  StyleControl = (): Element => <button aria-label="Change theme" onClick={this.changeTheme}
    class={"tooltip control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons-outlined">style</i>
    <span class="tooltiptext right">Change theme</span>
  </button>

  FullScreenControl = (): Element => <button aria-label="Full screen mode" onClick={() => this.toggleFullscreen()}
    class={"tooltip control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons" aria-label="Full screen mode">{this.fullscreen ? 'fullscreen_exit' : 'fullscreen'}</i>
    <span class="tooltiptext right">Toogle screen mode</span>
  </button>

  TextTranslationDisplayControl = (): Element => <button data-cy="translation-toggle" aria-label="Toggle Translation"
    onClick={() => this.toggleTextTranslation()}
    class={"tooltip control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons-outlined">subtitles</i>
    <span class="tooltiptext right">Toggle translation</span>
  </button>

  ControlPanel = (): Element => <div data-cy="control-panel"
    class={"control-panel theme--" + this.theme + " background--" + this.theme}>
    <div class="control-panel__buttons--left">
      <this.PlayControl />
      <this.ReplayControl />
      <this.StopControl />
      {this.mode === "ANCHOR" && <this.PlayReginControl />}
      {this.mode === "ANCHOR" && <this.DeleteReginControl />}
      {this.mode === "PREVIEW" && <this.ExportPreviewControl />}
    </div>

    <div class="control-panel__buttons--center">
      <this.PlaybackSpeedControl />
    </div>

    <div class="control-panel__buttons--right">
      {this.hasTextTranslations && <this.TextTranslationDisplayControl />}
      <this.StyleControl />
      <this.FullScreenControl />
    </div>
  </div>


  /**
   * Render main component
   */
  render(): Element {
    return (
      <div id='read-along-container' class='read-along-container'>
        <h1 class="slot__header">
          <slot name="read-along-header" />
        </h1>
        <h3 class="slot__subheader">
          <slot name="read-along-subheader" />
        </h3>
        <div id='wave' hidden={this.mode !== 'ANCHOR'}></div>
        {
          this.assetsStatus.AUDIO &&
          <p data-cy="audio-error"
            class={"alert status-" + this.assetsStatus.AUDIO + (this.assetsStatus.AUDIO == LOADED ? ' fade' : '')}>
            <span
              class="material-icons-outlined"> {this.assetsStatus.AUDIO == ERROR_LOADING ? 'error' : (this.assetsStatus.AUDIO > 0 ? 'done' : 'pending_actions')}</span>
            <span>{this.assetsStatus.AUDIO == ERROR_LOADING ? returnTranslation('audio-error', this.language) : (this.assetsStatus.SMIL > 0 ? 'AUDIO' : returnTranslation('loading', this.language))}</span>
          </p>
        }

        {
          this.assetsStatus.XML && <p data-cy="text-error"
            class={"alert status-" + this.assetsStatus.XML + (this.assetsStatus.XML == LOADED ? ' fade' : '')}>
            <span
              class="material-icons-outlined"> {this.assetsStatus.XML == ERROR_LOADING ? 'error' : (this.assetsStatus.XML > 0 ? 'done' : 'pending_actions')}</span>
            <span>{this.assetsStatus.XML == ERROR_LOADING ? returnTranslation('text-error', this.language) : (this.assetsStatus.SMIL > 0 ? 'XML' : returnTranslation('loading', this.language))}</span>
          </p>
        }

        {
          this.assetsStatus.SMIL && <p data-cy="alignment-error"
            class={"alert status-" + this.assetsStatus.SMIL + (this.assetsStatus.SMIL == LOADED ? ' fade' : '')}>
            <span
              class="material-icons-outlined"> {this.assetsStatus.SMIL == ERROR_LOADING ? 'error' : (this.assetsStatus.SMIL > 0 ? 'done' : 'pending_actions')}</span>
            <span>{this.assetsStatus.SMIL == ERROR_LOADING ? returnTranslation('alignment-error', this.language) : (this.assetsStatus.SMIL > 0 ? 'SMIL' : returnTranslation('loading', this.language))}</span>
          </p>
        }
        {
          this.anchorAlertMessage && this.anchorAlertMessage.show && <p data-cy="anchor-error"
            class={"alert status-2"} >

            <span
              class="material-icons-outlined"> error </span>
            <span>{this.anchorAlertMessage.message}</span>
            <button style={{ border: 'none', padding: '0px', float: 'right' }} class='alert status-2' onClick={this.closeAnchorAlert}>
              <span class="material-icons">
                cancel
              </span>
            </button >
          </p>
        }
        <div data-cy="text-container" class={"pages__container theme--" + this.theme + " " + this.pageScrolling}>

          {this.showGuide ? <this.Guide /> : null}
          {this.assetsStatus.XML == LOADED && this.parsed_text.map((page) =>
            <this.Page pageData={page}>
            </this.Page>
          )}
          {this.isLoaded == false && <div class="loader" />}

        </div>
        {this.assetsStatus.SMIL == LOADED &&
          <div onClick={(e) => this.goToSeekFromProgress(e)} id='all' data-cy="progress-bar"
            class={"overlay__container theme--" + this.theme + " background--" + this.theme}>
            {this.svgOverlay ? <this.Overlay /> : null}
          </div>}
        {this.assetsStatus.AUDIO == LOADED && <this.ControlPanel />}


        {this.cssUrl && this.cssUrl.match(".css") != null && <link href={this.cssUrl} rel="stylesheet" />}

        <div>
          <nav id="context-menu" class="context-menu" data-id=""  >
            <ul class="context-menu__items">
              <li>
                <div class="context-menu__item" id='context-menu-div'>
                  <a href="#" class="context-menu__link" data-action="add-anchor"
                    onClick={this.insertAnchorBefore}>
                    Insert Anchor Before
                  </a>
                </div>
              </li>
              <li>
                <div class="context-menu__item" id='context-menu-div'>
                  <a href="#" class="context-menu__link" data-action="add-anchor-after"
                    onClick={this.insertAnchorAfter}>
                    Insert Anchor After
                  </a>
                </div>
              </li>
              <li>
                <div class="context-menu__item" id='context-menu-div'>
                  <a href="#" class="context-menu__link" data-action="del-anchor"
                    onClick={this.deleteAnchor}>
                    Remove
                  </a>
                </div>
              </li>
            </ul>
          </nav>

        </div>
      </div>

    )
  }
}