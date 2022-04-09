import {Component, Element, Listen, Prop, State, h} from '@stencil/core';
import {distinctUntilChanged} from 'rxjs/operators';
import {Subject} from 'rxjs';
import {Howl} from 'howler';
import {Alignment, Page, parseSMIL, parseTEI, Sprite, generatePreviewXML} from '../../utils/utils'
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/src/plugin/regions';
import MarkersPlugin from 'wavesurfer.js/src/plugin/markers';


const LOADING = 0;
const LOADED = 1;
const ERROR_LOADING = 2;
export type InterfaceLanguage = "eng" | "fra";//iso 639-3 code
export type Translation = {
  [lang in InterfaceLanguage]: string;
};

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
  @Prop({mutable: true}) text: string;



  /**
   * The alignment as SMIL
   */
  @Prop({mutable: true}) alignment: string;

  processed_alignment: Alignment;

  /**
   * The audio file
   */
  @Prop({mutable: true}) audio: string;

  audio_howl_sprites: Howl;
  reading$: Subject<string>; // An RxJs Subject for the current item being read.
  duration: number; // Duration of the audio file

  /**
   * Overlay
   * This is an SVG overlay to place over the progress bar
   */
  @Prop() svgOverlay: string;

  /**
   * Theme to use: ['light', 'dark'] defaults to 'dark'
   */
  @Prop({mutable: true}) theme: string = 'light';

  /**
   * Language  of the interface. In 639-3 code
   * Options are
   * - "eng" for English
   * - "fra" for French
   */
  @Prop({mutable: true}) language: InterfaceLanguage = 'eng';

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
   * Toggle Anchor dropping mode
   */
  @Prop() editable: boolean = false;

  /**
   * Base folder for assets
   */
  @Prop() base: string;

  /**
   * Toggles the page scrolling from horizontal to vertical. Defaults to horizontal
   *
   */

  @Prop() pageScrolling: "horizontal" | "vertical" = "horizontal";

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

  @State() isAnchorMode: boolean = false;
  showGuide: boolean = false;

  parsed_text;

  current_page;
  hasTextTranslations: boolean = false;
  assetsStatus = {
    'AUDIO': LOADING,
    'XML': LOADING,
    'SMIL': LOADING
  };

  wavesurfer: WaveSurfer;
  waveform : HTMLElement;
  anchors : any[] = [];

  /************
   *  LISTENERS  *
   ************/

  @Listen('wheel', {target: 'window'})
  wheelHandler(event: MouseEvent): void {
    // only show guide if there is an actual highlighted element
    if (this.el.shadowRoot.querySelector('.reading')) {
      if (event['path'][0].classList.contains("sentence__word") ||
        event['path'][0].classList.contains("sentence__container") ||
        event['path'][0].classList.contains("sentence")) {
        if (this.autoScroll) {
          let reading_el: HTMLElement = this.el.shadowRoot.querySelector('.reading')
          if (reading_el) {
            this.autoScroll = !this.inPageContentOverflow(reading_el);
            this.showGuide = !this.autoScroll;
          }
        }
      }
    }
  }

  /***********
   *  UTILS  *
   ***********/
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
   * Given an audio file path and a parsed alignment object,
   * build a Sprite object
   * @param audio
   * @param alignment
   */
  private buildSprite(audio: string, alignment: Alignment) {
    return new Sprite({
      src: [audio],
      sprite: alignment,
      rate: this.playback_rate
    });
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
    for (let i = 1; i < keys.length; i++) {
      if (s * 1000 > this.processed_alignment[keys[i]][0]
        && this.processed_alignment[keys[i + 1]]
        && s * 1000 < this.processed_alignment[keys[i + 1]][0]) {
        return this.el.shadowRoot.querySelector(this.tagToQuery(keys[i]))
      }
    }
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
  changePlayback(ev: Event): void {
    let inputEl = ev.currentTarget as HTMLInputElement
    this.playback_rate =  parseInt(inputEl.value) / 100
    this.audio_howl_sprites.sound.rate(this.playback_rate)
  }

  /**
   *  Go back s milliseconds
   *
   * @param s
   */

  goBack(s: number): void {
    this.autoScroll = false;
    if (this.play_id) {
      this.audio_howl_sprites.goBack(this.play_id, s)
    }
    setTimeout(() => this.autoScroll = true, 100)
  }

  /**
   *  Highlight specific wording given by time.
   *
   * @param s
   */
  goToTime(time: number): void {
    let query_el = this.returnWordClosestTo(time);
    if (!query_el) return;

    let tag = query_el.id;
    let seek = this.processed_alignment[tag][0];
    this.addHighlightingTo(query_el);
    this.goTo(seek);

    // Scroll horizontally (to different page) if needed
    let current_page = ReadAlongComponent._getSentenceContainerOfWord(query_el).parentElement.id
    if (current_page !== this.current_page) {
      if (this.current_page !== undefined) {
        this.scrollToPage(current_page)
      }
      this.current_page = current_page
    }

    // scroll vertically (through paragraph) if needed
    if (this.inPageContentOverflow(query_el)) {
      if (this.autoScroll) {
        query_el.scrollIntoView(false);
        this.scrollByHeight(query_el)
      }
    }
    // scroll horizontal (through paragraph) if needed
    if (this.inParagraphContentOverflow(query_el)) {
      if (this.autoScroll) {
        query_el.scrollIntoView(false);
        this.scrollByWidth(query_el)
      }
    }
  }

  /**
   * Get the Time for given element.
   *
   * @param ev
   */
  getTime(tag: number): number {
    let seek = this.processed_alignment[tag][0]
    return seek / 1000;
  }

  /**
   * Go to seek
   *
   * @param seek number
   *
   */
  goTo(seek: number): void {
    if (this.play_id === undefined) {
      this.play();
      this.pause();
    }
    this.autoScroll = false;
    seek = seek / 1000
    this.audio_howl_sprites.goTo(this.play_id, seek)
    setTimeout(() => this.autoScroll = true, 100)
  }

  /**
   * Go to seek from id
   *
   * @param ev
   */
  goToSeekAtEl(ev: MouseEvent): string {
    let el = ev.currentTarget as HTMLElement
    let tag = el.id;
    let seek = this.processed_alignment[tag][0]
    this.goTo(seek)
    return tag
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
    let seek = ((click / width) * this.duration) * 1000
    this.goTo(seek)
  }


  /**
   * Pause audio.
   */
  pause(): void {
    this.playing = false;
    this.audio_howl_sprites.pause()
  }


  /**
   * Play the current audio, or start a new play of all
   * the audio
   *
   *
   */
  play() {
    this.playing = true;
    // If already playing once, continue playing
    if (this.play_id !== undefined) {
      this.play_id = this.audio_howl_sprites.play(this.play_id)
    } else {
      // else, start a new play
      this.play_id = this.audio_howl_sprites.play('all')
    }
    // animate the progress bar
    this.animateProgress()

  }

  /**
   * Seek to an element with id 'id', then play it
   *
   * @param ev
   */
  playSprite(ev: MouseEvent): void {
    let tag = this.goToSeekAtEl(ev)
    if (!this.playing) {
      this.audio_howl_sprites.play(tag)
    }
  }


  /**
   * Stop the sound and remove all active reading styling
   */
  stop(): void {
    this.playing = false;
    this.audio_howl_sprites.stop()
    this.el.shadowRoot.querySelectorAll(".reading").forEach(x => x.classList.remove('reading'))

    if (!this.autoScroll) {
      this.autoScroll = true;
      this.showGuide = false;
    }

  }

  /**
   * Toggle Anchor Mode
   */
  toggleAnchor(): void {
    this.isAnchorMode = !this.isAnchorMode;
    this.waveform.classList.toggle('anchorHide')
  }

  /**
   * toggle the visibility of translation text
   */
  toggleTextTranslation(): void {
    this.el.shadowRoot.querySelectorAll('.translation').forEach(translation => translation.classList.toggle('hide'))
    this.el.shadowRoot.querySelectorAll('.sentence__translation').forEach(translation => translation.classList.toggle('hide'))

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
    this.el.shadowRoot.querySelectorAll(".reading").forEach(x => x.classList.remove('reading'))
    el.classList.add('reading')
  }

  /**
   * Animate the progress through the overlay svg
   */
  animateProgressWithOverlay(): void {
    // select svg container
    let wave__container: any = this.el.shadowRoot.querySelector('#overlay__object')
    // use svg container to grab fill and trail
    let fill: HTMLElement = wave__container.contentDocument.querySelector('#progress-fill')
    let trail = wave__container.contentDocument.querySelector('#progress-trail')
    let base = wave__container.contentDocument.querySelector('#progress-base')
    fill.classList.add('stop-color--' + this.theme)
    base.classList.add('stop-color--' + this.theme)

    // push them to array to be changed in step()
    this.audio_howl_sprites.sounds.push(fill)
    this.audio_howl_sprites.sounds.push(trail)
    // When this sound is finished, remove the progress element.
    this.audio_howl_sprites.sound.once('end', () => {
      this.audio_howl_sprites.sounds.forEach(x => {
        x.setAttribute("offset", '0%');
      });
      this.el.shadowRoot.querySelectorAll(".reading").forEach(x => x.classList.remove('reading'))
      this.playing = false;
      // }
    }, this.play_id);
  }

  /**
   * Animate the progress if no svg overlay is provided
   *
   * @param play_id
   * @param tag
   */
  animateProgressDefault(play_id: number, tag: string): void {
    let elm = document.createElement('div');
    elm.className = 'progress theme--' + this.theme;
    elm.id = play_id.toString();
    elm.dataset.sprite = tag;
    let query = this.tagToQuery(tag);
    this.el.shadowRoot.querySelector(query).appendChild(elm);
    this.audio_howl_sprites.sounds.push(elm);

    // When this sound is finished, remove the progress element.
    this.audio_howl_sprites.sound.once('end', () => {
      // this.audio_howl_sprites = [];
      this.el.shadowRoot.querySelectorAll(".reading").forEach(x => x.classList.remove('reading'))
      this.playing = false;
      // }
    }, this.play_id);
  }

  /**
   * Animate progress, either by default or with svg overlay.
   */
  animateProgress(play_id = this.play_id): void {
    // Start animating progress
    if (this.svgOverlay) {
      // either with svg overlay
      this.animateProgressWithOverlay();
    } else {
      // or default progress bar
      this.animateProgressDefault(play_id, 'all');
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
  changeTheme(): void {
    if (this.theme === 'light') {
      this.theme = 'dark'
    } else {
      this.theme = 'light'
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

  /****
   * AUDIO HANDLING
   *
   */
  audioFailedToLoad() {

    this.isLoaded = true;
    this.assetsStatus.AUDIO = ERROR_LOADING;

  }

  audioLoaded() {

    this.isLoaded = true;
    this.assetsStatus.AUDIO = LOADED;

  }

  /**
   * Handle Word Click
   */
  handleWord(ev: MouseEvent): void {
    if (!this.isAnchorMode){
      this.playSprite(ev);
    }
    else {
      let el = ev.currentTarget as HTMLInputElement
      let id = el.id;
      let isAdding = !(this.anchors.some(x => x.id == id));

      (isAdding) ? this.addAnchor(el) : this.delAnchor(el);
    }
  }

  /**
   * Add Anchor to the waveform
   */
  addAnchor(element) : any{

    let id = element.id;
    let text = element.innerHTML;
    let time = this.processed_alignment[id][0] / 1000;
    let color = this.palette.pop();

    let anchor =  this.wavesurfer.markers.add({
      time: time,
      label: "",
      color: color,
      draggable: true,
    });
    // Enrich the anchor information
    anchor.id = id;
    anchor.text = text;

    // Put Anchor into the list
    this.anchors.push(anchor);

    // Add Anchor icon
    let icon = this.createAnchor(id, color);
    element.parentElement.insertBefore(icon, element);
  }


  /**
   * Delete Anchor from waveform
   */
  delAnchor(element){
    let id = element.id;

    // Lookup the Anchor
    var anchor = this.anchors.filter((x) => x.id == id)[0];
    let index = this.wavesurfer.markers.markers.indexOf(anchor);
    this.wavesurfer.markers.remove(index);

    // Remove from list
    this.anchors = this.anchors.filter((x) => x.id != id);

    // Remove Anchor Icon [Use the Tag ID to lookup the SVG anchor]
    let svg = this.el.shadowRoot.querySelector(`#svg${id}`);
    svg.parentElement.removeChild(svg);
  }

  createAnchor(id, color) {

    let markerWidth = 11;
    let markerHeight = 22;

    var svgNS = "http://www.w3.org/2000/svg";
    var el = document.createElementNS(svgNS, "svg") as HTMLElement;
    var polygon = document.createElementNS(svgNS, "polygon");
    el.setAttribute("viewBox", "0 0 40 80");
    polygon.setAttribute("id", "polygon");
    polygon.setAttribute("stroke", "#979797");
    polygon.setAttribute("fill", color);
    polygon.setAttribute("points", "20 0 40 30 40 80 0 80 0 30");

    el.appendChild(polygon);

    // Update style instead of using class since SVG will ignore CSS class
    el.id = `svg${id}`;
    el.style.width= markerWidth  +"px";
    el.style.height= markerHeight +"px";
    el.style.minWidth = markerWidth +"px";
    el.style.marginRight = "5px";
    el.style.zIndex = "4";
    el.style.cursor = "pointer";

    return el;
  }

  /**
   * Waveform Control Panel
   */
  playPause() : void {
    this.wavesurfer.playPause();
  }

  playRegion() : void {
    let region = Object.values(this.wavesurfer.regions.list)[0] as any;
    if (region) {
        if (this.wavesurfer.isPlaying()){
          this.wavesurfer.playPause();
        }
        else{
          region.play();
      }
    }
  }


  previewAnchor() : void {
    if (this.isValidAnchorSetup()){
      let xmlString = generatePreviewXML(this.text, this.anchors);
      if (typeof window["updateAnchor"] === 'function') {
        window["updateAnchor"].call(xmlString);
      }
      else{
        alert("window[updateAnchor].call(xmlString)");
      }
    }
  }

  exportPreview() : void {
    if (this.isValidAnchorSetup()) {
      window.location.href = "/download/aligned_preview";
    }
  }

  exportOriginal() : void {
    window.location.href = `/download/${this.base}`;
  }

  /**
   * Validate the Anchor ordering
   */
  isValidAnchorSetup() : boolean {
    if (this.anchors.length == 0) {
      // toast.show("error", "There is no anchor setup currently.")
      alert("There is no anchor setup currently.");
      return false;
    }

    // Sort using the id, then copmare the timestamp
    this.anchors.sort(function (a, b) {
      let idA = parseInt(a.id.match(/(\d+)/g).join(""));
      let idB = parseInt(b.id.match(/(\d+)/g).join(""));
      return idA - idB;
    });

    let previous = { time: -1 } as { time: number , text: string };
    for (let i = 0; i < this.anchors.length; i++) {
      if (previous.time > this.anchors[i].time) {
        alert(`The text "${this.anchors[i].text}" is earlier than the previous text "${previous.text}"`);
        return false;
      }
      previous = this.anchors[i];
    }
    return true;
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

  }

  /**
   * Lifecycle hook: after component loads, build the Sprite and parse the files necessary.
   * Then subscribe to the _reading$ Subject in order to update CSS styles when new element
   * is being read
   */
  componentDidLoad() {
    let _self = this

    this.processed_alignment = parseSMIL(this.alignment)
    this.assetsStatus.SMIL = Object.keys(this.processed_alignment).length ? LOADED : ERROR_LOADING

    // load basic Howl
    this.audio_howl_sprites = new Howl({
      src: [this.audio],
      preload: true,
      onloaderror: this.audioFailedToLoad.bind(this),
      onload: this.audioLoaded.bind(this)

    })
    // Once loaded, get duration and build Sprite
    this.audio_howl_sprites.once('load', () => {

      this.processed_alignment['all'] = [0, this.audio_howl_sprites.duration() * 1000];
      this.duration = this.audio_howl_sprites.duration();
      this.audio_howl_sprites = this.buildSprite(this.audio, this.processed_alignment);
      // Once Sprites are built, subscribe to reading subject and update element class
      // when new distinct values are emitted
      this.reading$ = this.audio_howl_sprites._reading$.pipe(
        distinctUntilChanged()
      ).subscribe(el_tag => {
        // Only highlight when playing
        if (this.playing) {
          // Turn tag to query
          let query = this.tagToQuery(el_tag);
          // select the element with that tag
          let query_el: HTMLElement = this.el.shadowRoot.querySelector(query);
          // Remove all elements with reading class
          this.el.shadowRoot.querySelectorAll(".reading").forEach(x => x.classList.remove('reading'))
          // Add reading to the selected el
          query_el.classList.add('reading')

          // Scroll horizontally (to different page) if needed
          let current_page = ReadAlongComponent._getSentenceContainerOfWord(query_el).parentElement.id

          if (current_page !== this.current_page) {
            if (this.current_page !== undefined) {
              this.scrollToPage(current_page)
            }
            this.current_page = current_page
          }

          //if the user has scrolled away from the from the current page bring them page
          if (query_el.getBoundingClientRect().left < 0 || this.el.shadowRoot.querySelector("#" + current_page).getBoundingClientRect().left !== 0) {
            this.scrollToPage(current_page)
          }

          // scroll vertically (through paragraph) if needed
          if (this.inPageContentOverflow(query_el)) {
            if (this.autoScroll) {
              query_el.scrollIntoView(false);
              this.scrollByHeight(query_el)
            }
          }// scroll horizontal (through paragraph) if needed
          if (this.inParagraphContentOverflow(query_el)) {
            if (this.autoScroll) {
              query_el.scrollIntoView(false);
              this.scrollByWidth(query_el)
            }
          }
        }
      })
      this.isLoaded = true;
      this.assetsStatus.AUDIO = LOADED;
    })
    // Parse the text to be displayed
    this.parsed_text = parseTEI(this.text)

    this.assetsStatus.XML = this.parsed_text.length ? LOADED : ERROR_LOADING

    this.waveform = this.el.shadowRoot.querySelector("#anchorWave");

    this.wavesurfer = WaveSurfer.create({
      container: this.waveform,
      waveColor: "#A8DBA8",
      progressColor: "#3B8686",
      backend: "MediaElement",
      responsive: true,
      plugins: [
        MarkersPlugin.create({
          markers: [
            {
              id: "pointer",
              time: 0,
              label: "",
              position: "top",
              color: "#ffaa11",
              draggable: true,
            },
          ],
        }),
        RegionsPlugin.create({
          regions: [],
          dragSelection: {
            slop: 5,
          },
        }),
      ],
    });

    this.wavesurfer.load(this.audio);

    this.wavesurfer.on("region-created", function (region) {
      let list = _self.wavesurfer.regions.list;
      if (Object.entries(list).length >= 1) {
        region.remove();
      }
    });

    this.wavesurfer.on("marker-drop", function (marker) {
      if (marker.position === "top") {
        _self.goToTime(marker.time);
      }
    });

    this.wavesurfer.on("waveform-ready", function () {
      _self.waveform.classList.add("anchorHide");
    });

  }

  /**********
   *  LANG  *
   **********/

  /**
   * Any text used in the Web Component should be at least bilingual in English and French.
   * To add a new term, add a new key to the translations object. Then add 'eng' and 'fr' keys
   * and give the translations as values.
   *
   * @param word
   * @param lang
   */
  returnTranslation(word: string, lang?: InterfaceLanguage): string {
    if (lang === undefined) lang = this.language;
    let translations: { [message: string]: Translation } = {
      "speed": {
        "eng": "Playback Speed",
        "fra": "Vitesse de Lecture"
      },
      "re-align": {
        "eng": "Re-align with audio",
        "fra": "Réaligner avec l'audio"
      },
      "audio-error": {
        "eng": "Error: The audio file could not be loaded",
        "fra": "Erreur: le fichier audio n'a pas pu être chargé"
      },
      "text-error": {
        "eng": "Error: The text file could not be loaded",
        "fra": "Erreur: le fichier texte n'a pas pu être chargé"
      },
      "alignment-error": {
        "eng": "Error: The alignment file could not be loaded",
        "fra": "Erreur: le fichier alignement n'a pas pu être chargé"
      },
      "loading": {
        "eng": "Loading...",
        "fra": "Chargement en cours"
      }
    }
    if (translations[word])
      return translations[word][lang]
    return word;
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
        {this.returnTranslation('re-align', this.language)}
      </span>
    </button>

  /**
   * Render svg overlay
   */
  Overlay = (): Element => <object onClick={(e) => this.goToSeekFromProgress(e)} id='overlay__object'
                                   type='image/svg+xml' data={this.svgOverlay}/>

  /**
   * Render image at path 'url' in assets folder.
   *
   * @param props
   */
  Img = (props: { url: string }): Element => {


    return (<div class={"image__container page__col__image theme--" + this.theme}>
      <img alt={"image"} class="image" src={this.urlTransform(props.url)}/>
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
                                                      currentPage={this.parsed_text.indexOf(props.pageData) + 1}/> : null
      }
      { /* Display an Img if it exists on the page */
        props.pageData.img ? <this.Img url={props.pageData.img}/> : null
      }
      <div class={"page__col__text paragraph__container theme--" + this.theme}>
        { /* Here are the Paragraph children */
          props.pageData.paragraphs.map((paragraph: Element) => {

              return <this.Paragraph sentences={Array.from(paragraph.childNodes)} attributes={paragraph.attributes}/>
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
          <this.Sentence words={Array.from(sentence.childNodes)} attributes={sentence.attributes}/>)
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
                                     id={(props.attributes["id"] ? props.attributes["id"].value : "P") + 'text' + c}/>
          } else if (child.nodeName === 'w') {
            return <this.Word text={child.textContent} id={child['id']} attributes={child.attributes}/>
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
                 id={props.id} onClick={(ev) => this.handleWord(ev)}>{props.text}</span>
  }
  /**
   * Render controls for ReadAlong
   */

  PlayControl = (): Element => <button data-cy="play-button" disabled={!this.isLoaded} aria-label="Play"
                                       onClick={() => {
                                         this.playing ? this.pause() : this.play()
                                       }}
                                       class={"control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons">{this.playing ? 'pause' : 'play_arrow'}</i>
  </button>

  ReplayControl = (): Element => <button data-cy="replay-button" disabled={!this.isLoaded} aria-label="Rewind"
                                         onClick={() => this.goBack(5)}
                                         class={"control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons">replay_5</i>
  </button>

  StopControl = (): Element => <button data-cy="stop-button" disabled={!this.isLoaded} aria-label="Stop"
                                       onClick={() => this.stop()}
                                       class={"control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons">stop</i>
  </button>

  EditControl = (): Element => this.editable ? <input type="checkbox" data-cy="edit-button" aria-label="Edit"  data-check-switch="" role="switch" 
                                       onChange={() => this.toggleAnchor()}
                                       class={"control-panel__control ripple theme--" + this.theme + " background--" + this.theme}
                                       /> : <div/>


  PlaybackSpeedControl = (): Element => <div>
    <h5
      class={"control-panel__buttons__header color--" + this.theme}>{this.returnTranslation('speed', this.language)}</h5>
    <input type="range" min="75" max="125" value={this.playback_rate * 100} class="slider control-panel__control"
           id="myRange" onInput={(v) => this.changePlayback(v)}/>
  </div>

  StyleControl = (): Element => <button aria-label="Change theme" onClick={() => this.changeTheme()}
                                        class={"control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons-outlined">style</i>
  </button>

  FullScreenControl = (): Element => <button aria-label="Full screen mode" onClick={() => this.toggleFullscreen()}
                                             class={"control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons" aria-label="Full screen mode">{this.fullscreen ? 'fullscreen_exit' : 'fullscreen'}</i>
  </button>

  TextTranslationDisplayControl = (): Element => <button data-cy="translation-toggle" aria-label="Toggle Translation"
                                                         onClick={() => this.toggleTextTranslation()}
                                                         class={"control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
    <i class="material-icons-outlined">subtitles</i>
  </button>

  ControlPanel = (): Element => <div data-cy="control-panel"
                                     class={"control-panel theme--" + this.theme + " background--" + this.theme}>
    <div class="control-panel__buttons--left">
      <this.PlayControl/>
      <this.ReplayControl/>
      <this.StopControl/>
      <this.EditControl/>
    </div>

    <div class="control-panel__buttons--center">
      <this.PlaybackSpeedControl/>
    </div>

    <div class="control-panel__buttons--right">
      {this.hasTextTranslations && <this.TextTranslationDisplayControl/>}
      <this.StyleControl/>
      <this.FullScreenControl/>
    </div>
  </div>

  /**
   * Render for Anchor Controls
   * @returns 
   */
  PlayWaveControl = (): Element => <button data-cy="play-wave-button" aria-label="Play/Pause"
                                          onClick={() => this.playPause()}
                                          class={"control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
                                      <i class="material-icons-outlined">play_arrow</i> Play / Pause
                                    </button>
  PlayRegionControl = (): Element => <button data-cy="region-wave-button" aria-label="Preview Anchor"
                                          onClick={() => this.playRegion()}
                                          class={"control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
                                      <i class="material-icons-outlined">loop</i> Play Region
                                    </button>
  PreviewControl = (): Element => <button data-cy="preview-wave-button" aria-label="Preview Anchor"
                                          onClick={() => this.previewAnchor()}
                                          class={"control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
                                    <i class="material-icons-outlined">headphones</i> Preview
                                  </button>
  ExportPreviewControl = (): Element => <button data-cy="export-original-button" aria-label="Export Preview"
                                              onClick={() => this.exportPreview()}
                                              class={"control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
                                            <i class="material-icons-outlined">file_download</i> Save Preview
                                          </button>
  ExportOriginalControl = (): Element => <button data-cy="export-original-button" aria-label="Export Original"
                                                onClick={() => this.exportOriginal()}
                                                class={"control-panel__control ripple theme--" + this.theme + " background--" + this.theme}>
                                            <i class="material-icons-outlined">system_update_alt</i> Save Original
                                          </button>

  AnchorPanel = (): Element => <div data-cy="control-panel"
                                     class={"control-panel theme--" + this.theme + " background--" + this.theme}>
    <div class="anchor-panel">
      <this.PlayWaveControl/>
      <this.PlayRegionControl/>
      <this.PreviewControl/>
      <this.ExportPreviewControl/>
      <this.ExportOriginalControl/>
    </div>
  </div>


  /**
   * Render main component
   */
  render(): Element {
    return (
      <div id='read-along-container' class='read-along-container'>
        <h1 class="slot__header">
          <slot name="read-along-header"/>
        </h1>
        <h3 class="slot__subheader">
          <slot name="read-along-subheader"/>
        </h3>
        { this.editable &&  <div id="anchorWave" /> }
        {
          this.assetsStatus.AUDIO &&
          <p data-cy="audio-error"
             class={"alert status-" + this.assetsStatus.AUDIO + (this.assetsStatus.AUDIO == LOADED ? ' fade' : '')}>
            <span
              class="material-icons-outlined"> {this.assetsStatus.AUDIO == ERROR_LOADING ? 'error' : (this.assetsStatus.AUDIO > 0 ? 'done' : 'pending_actions')}</span>
            <span>{this.assetsStatus.AUDIO == ERROR_LOADING ? this.returnTranslation('audio-error', this.language) : (this.assetsStatus.SMIL > 0 ? 'AUDIO' : this.returnTranslation('loading', this.language))}</span>
          </p>
        }

        {
          this.assetsStatus.XML && <p data-cy="text-error"
                                      class={"alert status-" + this.assetsStatus.XML + (this.assetsStatus.XML == LOADED ? ' fade' : '')}>
            <span
              class="material-icons-outlined"> {this.assetsStatus.XML == ERROR_LOADING ? 'error' : (this.assetsStatus.XML > 0 ? 'done' : 'pending_actions')}</span>
            <span>{this.assetsStatus.XML == ERROR_LOADING ? this.returnTranslation('text-error', this.language) : (this.assetsStatus.SMIL > 0 ? 'XML' : this.returnTranslation('loading', this.language))}</span>
          </p>
        }

        {
          this.assetsStatus.SMIL && <p data-cy="alignment-error"
                                       class={"alert status-" + this.assetsStatus.SMIL + (this.assetsStatus.SMIL == LOADED ? ' fade' : '')}>
            <span
              class="material-icons-outlined"> {this.assetsStatus.SMIL == ERROR_LOADING ? 'error' : (this.assetsStatus.SMIL > 0 ? 'done' : 'pending_actions')}</span>
            <span>{this.assetsStatus.SMIL == ERROR_LOADING ? this.returnTranslation('alignment-error', this.language) : (this.assetsStatus.SMIL > 0 ? 'SMIL' : this.returnTranslation('loading', this.language))}</span>
          </p>
        }
        <div data-cy="text-container" class={"pages__container theme--" + this.theme + " " + this.pageScrolling}>

          {this.showGuide ? <this.Guide/> : null}
          {this.assetsStatus.XML == LOADED && this.parsed_text.map((page) =>
            <this.Page pageData={page}>
            </this.Page>
          )}
          {this.isLoaded == false && <div class="loader"/>}

        </div>
        {this.assetsStatus.SMIL == LOADED &&
        <div onClick={(e) => this.goToSeekFromProgress(e)} id='all' data-cy="progress-bar"
             class={"overlay__container theme--" + this.theme + " background--" + this.theme}>
          {this.svgOverlay ? <this.Overlay/> : null}
        </div>}
        {this.assetsStatus.AUDIO == LOADED && <this.ControlPanel/>}
        {this.isAnchorMode && <this.AnchorPanel/>}

        {this.cssUrl && this.cssUrl.match(".css") != null && <link href={this.cssUrl} rel="stylesheet"/>}
      </div>

    )
  }


  palette = [
  "#69D2E7","#A7DBD8","#E0E4CC","#F38630","#FA6900",
  "#FE4365","#FC9D9A","#F9CDAD","#C8C8A9","#83AF9B",
  "#ECD078","#D95B43","#C02942","#542437","#53777A",
  "#556270","#4ECDC4","#C7F464","#FF6B6B","#C44D58",
  "#774F38","#E08E79","#F1D4AF","#ECE5CE","#C5E0DC",
  "#E8DDCB","#CDB380","#036564","#033649","#031634",
  "#490A3D","#BD1550","#E97F02","#F8CA00","#8A9B0F",
  "#594F4F","#547980","#45ADA8","#9DE0AD","#E5FCC2",
  "#00A0B0","#6A4A3C","#CC333F","#EB6841","#EDC951",
  "#E94E77","#D68189","#C6A49A","#C6E5D9","#F4EAD5",
  "#D9CEB2","#948C75","#D5DED9","#7A6A53","#99B2B7",
  "#FFFFFF","#CBE86B","#F2E9E1","#1C140D","#CBE86B",
  "#EFFFCD","#DCE9BE","#555152","#2E2633","#99173C",
  "#3FB8AF","#7FC7AF","#DAD8A7","#FF9E9D","#FF3D7F",
  "#343838","#005F6B","#008C9E","#00B4CC","#00DFFC",
  "#413E4A","#73626E","#B38184","#F0B49E","#F7E4BE",
  "#99B898","#FECEA8","#FF847C","#E84A5F","#2A363B",
  "#FF4E50","#FC913A","#F9D423","#EDE574","#E1F5C4",
  "#554236","#F77825","#D3CE3D","#F1EFA5","#60B99A",
  "#351330","#424254","#64908A","#E8CAA4","#CC2A41",
  "#00A8C6","#40C0CB","#F9F2E7","#AEE239","#8FBE00",
  "#FF4242","#F4FAD2","#D4EE5E","#E1EDB9","#F0F2EB",
  "#655643","#80BCA3","#F6F7BD","#E6AC27","#BF4D28",
  "#8C2318","#5E8C6A","#88A65E","#BFB35A","#F2C45A",
  "#FAD089","#FF9C5B","#F5634A","#ED303C","#3B8183",
  "#BCBDAC","#CFBE27","#F27435","#F02475","#3B2D38",
  "#D1E751","#FFFFFF","#000000","#4DBCE9","#26ADE4",
  "#FF9900","#424242","#E9E9E9","#BCBCBC","#3299BB",
  "#5D4157","#838689","#A8CABA","#CAD7B2","#EBE3AA",
  "#5E412F","#FCEBB6","#78C0A8","#F07818","#F0A830",
  "#EEE6AB","#C5BC8E","#696758","#45484B","#36393B",
  "#1B676B","#519548","#88C425","#BEF202","#EAFDE6",
  "#F8B195","#F67280","#C06C84","#6C5B7B","#355C7D",
  "#452632","#91204D","#E4844A","#E8BF56","#E2F7CE",
  "#F04155","#FF823A","#F2F26F","#FFF7BD","#95CFB7",
  "#F0D8A8","#3D1C00","#86B8B1","#F2D694","#FA2A00",
  "#2A044A","#0B2E59","#0D6759","#7AB317","#A0C55F",
  "#67917A","#170409","#B8AF03","#CCBF82","#E33258",
  "#B9D7D9","#668284","#2A2829","#493736","#7B3B3B",
  "#BBBB88","#CCC68D","#EEDD99","#EEC290","#EEAA88",
  "#A3A948","#EDB92E","#F85931","#CE1836","#009989",
  "#E8D5B7","#0E2430","#FC3A51","#F5B349","#E8D5B9",
  "#B3CC57","#ECF081","#FFBE40","#EF746F","#AB3E5B",
  "#AB526B","#BCA297","#C5CEAE","#F0E2A4","#F4EBC3",
  "#607848","#789048","#C0D860","#F0F0D8","#604848",
  "#3E4147","#FFFEDF","#DFBA69","#5A2E2E","#2A2C31",
  "#300030","#480048","#601848","#C04848","#F07241",
  "#1C2130","#028F76","#B3E099","#FFEAAD","#D14334",
  "#A8E6CE","#DCEDC2","#FFD3B5","#FFAAA6","#FF8C94",
  "#EDEBE6","#D6E1C7","#94C7B6","#403B33","#D3643B",
  "#FDF1CC","#C6D6B8","#987F69","#E3AD40","#FCD036",
  "#AAB3AB","#C4CBB7","#EBEFC9","#EEE0B7","#E8CAAF",
  "#CC0C39","#E6781E","#C8CF02","#F8FCC1","#1693A7",
  "#3A111C","#574951","#83988E","#BCDEA5","#E6F9BC",
  "#FC354C","#29221F","#13747D","#0ABFBC","#FCF7C5",
  "#B9D3B0","#81BDA4","#B28774","#F88F79","#F6AA93",
  "#5E3929","#CD8C52","#B7D1A3","#DEE8BE","#FCF7D3",
  "#230F2B","#F21D41","#EBEBBC","#BCE3C5","#82B3AE",
  "#5C323E","#A82743","#E15E32","#C0D23E","#E5F04C",
  "#4E395D","#827085","#8EBE94","#CCFC8E","#DC5B3E",
  "#DAD6CA","#1BB0CE","#4F8699","#6A5E72","#563444",
  "#C2412D","#D1AA34","#A7A844","#A46583","#5A1E4A",
  "#D1313D","#E5625C","#F9BF76","#8EB2C5","#615375",
  "#9D7E79","#CCAC95","#9A947C","#748B83","#5B756C",
  "#1C0113","#6B0103","#A30006","#C21A01","#F03C02",
  "#8DCCAD","#988864","#FEA6A2","#F9D6AC","#FFE9AF",
  "#CFFFDD","#B4DEC1","#5C5863","#A85163","#FF1F4C",
  "#75616B","#BFCFF7","#DCE4F7","#F8F3BF","#D34017",
  "#382F32","#FFEAF2","#FCD9E5","#FBC5D8","#F1396D",
  "#B6D8C0","#C8D9BF","#DADABD","#ECDBBC","#FEDCBA",
  "#E3DFBA","#C8D6BF","#93CCC6","#6CBDB5","#1A1F1E",
  "#A7C5BD","#E5DDCB","#EB7B59","#CF4647","#524656",
  "#9DC9AC","#FFFEC7","#F56218","#FF9D2E","#919167",
  "#413D3D","#040004","#C8FF00","#FA023C","#4B000F",
  "#EDF6EE","#D1C089","#B3204D","#412E28","#151101",
  "#A8A7A7","#CC527A","#E8175D","#474747","#363636",
  "#7E5686","#A5AAD9","#E8F9A2","#F8A13F","#BA3C3D",
  "#FFEDBF","#F7803C","#F54828","#2E0D23","#F8E4C1",
  "#C1B398","#605951","#FBEEC2","#61A6AB","#ACCEC0",
  "#5E9FA3","#DCD1B4","#FAB87F","#F87E7B","#B05574",
  "#951F2B","#F5F4D7","#E0DFB1","#A5A36C","#535233",
  "#FFFBB7","#A6F6AF","#66B6AB","#5B7C8D","#4F2958",
  "#000000","#9F111B","#B11623","#292C37","#CCCCCC",
  "#9CDDC8","#BFD8AD","#DDD9AB","#F7AF63","#633D2E",
  "#EFF3CD","#B2D5BA","#61ADA0","#248F8D","#605063",
  "#84B295","#ECCF8D","#BB8138","#AC2005","#2C1507",
  "#FCFEF5","#E9FFE1","#CDCFB7","#D6E6C3","#FAFBE3",
  "#0CA5B0","#4E3F30","#FEFEEB","#F8F4E4","#A5B3AA",
  "#4D3B3B","#DE6262","#FFB88C","#FFD0B3","#F5E0D3",
  "#B5AC01","#ECBA09","#E86E1C","#D41E45","#1B1521",
  "#379F7A","#78AE62","#BBB749","#E0FBAC","#1F1C0D",
  "#FFE181","#EEE9E5","#FAD3B2","#FFBA7F","#FF9C97",
  "#4E4D4A","#353432","#94BA65","#2790B0","#2B4E72",
  "#A70267","#F10C49","#FB6B41","#F6D86B","#339194",
  "#30261C","#403831","#36544F","#1F5F61","#0B8185",
  "#2D2D29","#215A6D","#3CA2A2","#92C7A3","#DFECE6",
  "#F38A8A","#55443D","#A0CAB5","#CDE9CA","#F1EDD0",
  "#793A57","#4D3339","#8C873E","#D1C5A5","#A38A5F",
  "#11766D","#410936","#A40B54","#E46F0A","#F0B300",
  "#AAFF00","#FFAA00","#FF00AA","#AA00FF","#00AAFF",
  "#C75233","#C78933","#D6CEAA","#79B5AC","#5E2F46",
  "#F8EDD1","#D88A8A","#474843","#9D9D93","#C5CFC6",
  "#6DA67A","#77B885","#86C28B","#859987","#4A4857",
  "#1B325F","#9CC4E4","#E9F2F9","#3A89C9","#F26C4F",
  "#BED6C7","#ADC0B4","#8A7E66","#A79B83","#BBB2A1",
  "#046D8B","#309292","#2FB8AC","#93A42A","#ECBE13",
  "#82837E","#94B053","#BDEB07","#BFFA37","#E0E0E0",
  "#312736","#D4838F","#D6ABB1","#D9D9D9","#C4FFEB",
  "#E5EAA4","#A8C4A2","#69A5A4","#616382","#66245B",
  "#6DA67A","#99A66D","#A9BD68","#B5CC6A","#C0DE5D",
  "#395A4F","#432330","#853C43","#F25C5E","#FFA566",
  "#331327","#991766","#D90F5A","#F34739","#FF6E27",
  "#FDFFD9","#FFF0B8","#FFD6A3","#FAAD8E","#142F30",
  "#E21B5A","#9E0C39","#333333","#FBFFE3","#83A300",
  "#FBC599","#CDBB93","#9EAE8A","#335650","#F35F55",
  "#C7FCD7","#D9D5A7","#D9AB91","#E6867A","#ED4A6A",
  "#EC4401","#CC9B25","#13CD4A","#7B6ED6","#5E525C",
  "#BF496A","#B39C82","#B8C99D","#F0D399","#595151",
  "#FFEFD3","#FFFEE4","#D0ECEA","#9FD6D2","#8B7A5E",
  "#F1396D","#FD6081","#F3FFEB","#ACC95F","#8F9924",
  "#F6F6F6","#E8E8E8","#333333","#990100","#B90504",
  "#261C21","#6E1E62","#B0254F","#DE4126","#EB9605",
  "#E9E0D1","#91A398","#33605A","#070001","#68462B",
  "#F2E3C6","#FFC6A5","#E6324B","#2B2B2B","#353634",
  "#FFAB07","#E9D558","#72AD75","#0E8D94","#434D53",
  "#59B390","#F0DDAA","#E47C5D","#E32D40","#152B3C",
  "#FDE6BD","#A1C5AB","#F4DD51","#D11E48","#632F53",
  "#E4E4C5","#B9D48B","#8D2036","#CE0A31","#D3E4C5",
  "#512B52","#635274","#7BB0A8","#A7DBAB","#E4F5B1",
  "#805841","#DCF7F3","#FFFCDD","#FFD8D8","#F5A2A2",
  "#CAFF42","#EBF7F8","#D0E0EB","#88ABC2","#49708A",
  "#595643","#4E6B66","#ED834E","#EBCC6E","#EBE1C5",
  "#E4DED0","#ABCCBD","#7DBEB8","#181619","#E32F21",
  "#058789","#503D2E","#D54B1A","#E3A72F","#F0ECC9",
  "#FF003C","#FF8A00","#FABE28","#88C100","#00C176",
  "#311D39","#67434F","#9B8E7E","#C3CCAF","#A51A41",
  "#EFD9B4","#D6A692","#A39081","#4D6160","#292522",
  "#C6CCA5","#8AB8A8","#6B9997","#54787D","#615145",
  "#CC5D4C","#FFFEC6","#C7D1AF","#96B49C","#5B5847",
  "#111625","#341931","#571B3C","#7A1E48","#9D2053",
  "#EFEECC","#FE8B05","#FE0557","#400403","#0AABBA",
  "#CCF390","#E0E05A","#F7C41F","#FC930A","#FF003D",
  "#73C8A9","#DEE1B6","#E1B866","#BD5532","#373B44",
  "#79254A","#795C64","#79927D","#AEB18E","#E3CF9E",
  "#E0EFF1","#7DB4B5","#FFFFFF","#680148","#000000",
  "#F06D61","#DA825F","#C4975C","#A8AB7B","#8CBF99",
  "#2D1B33","#F36A71","#EE887A","#E4E391","#9ABC8A",
  "#2B2726","#0A516D","#018790","#7DAD93","#BACCA4",
  "#95A131","#C8CD3B","#F6F1DE","#F5B9AE","#EE0B5B",
  "#360745","#D61C59","#E7D84B","#EFEAC5","#1B8798",
  "#E3E8CD","#BCD8BF","#D3B9A3","#EE9C92","#FE857E",
  "#807462","#A69785","#B8FAFF","#E8FDFF","#665C49",
  "#4B1139","#3B4058","#2A6E78","#7A907C","#C9B180",
  "#FC284F","#FF824A","#FEA887","#F6E7F7","#D1D0D7",
  "#FFB884","#F5DF98","#FFF8D4","#C0D1C2","#2E4347",
  "#027B7F","#FFA588","#D62957","#BF1E62","#572E4F",
  "#80A8A8","#909D9E","#A88C8C","#FF0D51","#7A8C89",
  "#A69E80","#E0BA9B","#E7A97E","#D28574","#3B1922",
  "#A1DBB2","#FEE5AD","#FACA66","#F7A541","#F45D4C",
  "#641F5E","#676077","#65AC92","#C2C092","#EDD48E",
  "#FFF3DB","#E7E4D5","#D3C8B4","#C84648","#703E3B",
  "#F5DD9D","#BCC499","#92A68A","#7B8F8A","#506266",
  "#2B222C","#5E4352","#965D62","#C7956D","#F2D974",
  "#D4F7DC","#DBE7B4","#DBC092","#E0846D","#F51441",
  "#A32C28","#1C090B","#384030","#7B8055","#BCA875",
  "#85847E","#AB6A6E","#F7345B","#353130","#CBCFB4",
  "#E6B39A","#E6CBA5","#EDE3B4","#8B9E9B","#6D7578",
  "#11644D","#A0B046","#F2C94E","#F78145","#F24E4E",
  "#6D9788","#1E2528","#7E1C13","#BF0A0D","#E6E1C2",
  "#23192D","#FD0A54","#F57576","#FEBF97","#F5ECB7",
  "#EB9C4D","#F2D680","#F3FFCF","#BAC9A9","#697060",
  "#D3D5B0","#B5CEA4","#9DC19D","#8C7C62","#71443F",
  "#452E3C","#FF3D5A","#FFB969","#EAF27E","#3B8C88",
  "#041122","#259073","#7FDA89","#C8E98E","#E6F99D",
  "#B1E6D1","#77B1A9","#3D7B80","#270A33","#451A3E",
  "#9D9E94","#C99E93","#F59D92","#E5B8AD","#D5D2C8",
  "#FDCFBF","#FEB89F","#E23D75","#5F0D3B","#742365",
  "#540045","#C60052","#FF714B","#EAFF87","#ACFFE9",
  "#B7CBBF","#8C886F","#F9A799","#F4BFAD","#F5DABD",
  "#280904","#680E34","#9A151A","#C21B12","#FC4B2A",
  "#F0FFC9","#A9DA88","#62997A","#72243D","#3B0819",
  "#429398","#6B5D4D","#B0A18F","#DFCDB4","#FBEED3",
  "#E6EBA9","#ABBB9F","#6F8B94","#706482","#703D6F",
  "#A3C68C","#879676","#6E6662","#4F364A","#340735",
  "#44749D","#C6D4E1","#FFFFFF","#EBE7E0","#BDB8AD",
  "#322938","#89A194","#CFC89A","#CC883A","#A14016",
  "#CFB590","#9E9A41","#758918","#564334","#49281F",
  "#FA6A64","#7A4E48","#4A4031","#F6E2BB","#9EC6B8",
  "#1D1313","#24B694","#D22042","#A3B808","#30C4C9",
  "#F6D76B","#FF9036","#D6254D","#FF5475","#FDEBA9",
  "#E7EDEA","#FFC52C","#FB0C06","#030D4F","#CEECEF",
  "#373737","#8DB986","#ACCE91","#BADB73","#EFEAE4",
  "#161616","#C94D65","#E7C049","#92B35A","#1F6764",
  "#26251C","#EB0A44","#F2643D","#F2A73D","#A0E8B7",
  "#4B3E4D","#1E8C93","#DBD8A2","#C4AC30","#D74F33",
  "#8D7966","#A8A39D","#D8C8B8","#E2DDD9","#F8F1E9",
  "#F2E8C4","#98D9B6","#3EC9A7","#2B879E","#616668"];

}
