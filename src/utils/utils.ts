export interface Page {
  id: string,
  paragraphs: Node[],
  img?: string,
  attributes?:NamedNodeMap[]
}

export interface Alignment {
  [id: string]: [number, number];
}

/**
 * Gets XML from path
 * @param {string} path - the path to the xml file
 */
export function getXML(path: string): string {

  let xmlhttp = new XMLHttpRequest();
  xmlhttp.open("GET", path, false);//TODO rewrite as async
  xmlhttp.addEventListener("error", function (error) {
    console.log(error);
  })
  xmlhttp.send();

  return xmlhttp.responseText;
}


/**
 * Return list of nodess from XPath
 * @param {string} xpath - the xpath to evaluate with
 * @param {Document} xml - the xml to evaluate
 */
export function getNodeByXpath(xpath: string, xml: Document): Node[] {
  let xmlns = xml.lookupNamespaceURI(null);
  if (xmlns === null) {
    // console.error("Your XML file is missing an XML namespace.");
  }
  function nsResolver(prefix) {
    var ns = {
      'i': xmlns
    };
    return ns[prefix] || null;
  }

  let result_container: Node[] = []
  let results = xml.evaluate(xpath, xml, nsResolver, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
  let node = results.iterateNext();
  while (node) {
    result_container.push(node);
    node = results.iterateNext()
  }
  return result_container
}


/**
 * Return a zipped array of arrays
 * @param {array[]} arrays
 */
export function zip(arrays): Array<any[]> {
  return arrays[0].map(function (_, i) {
    return arrays.map(function (array) { return array[i] })
  });
}

export function parseTEIString(xml: string): Page[] {
  let parser = new DOMParser();
  let xml_text = parser.parseFromString(xml, "text/xml")
  return parseTEIFromDoc(xml_text);
}
export function parseTEIFromDoc(xml_text: Document): Page[] {
  let pages = getNodeByXpath('.//div[@type="page"]', xml_text)
  let parsed_pages = pages.map((p: Element) => {
    let id = p.id;
    let img_xpath = `.//div[@id='${id}']/graphic/@url`
    let img = getNodeByXpath(img_xpath, xml_text)
    let p_xpath = `.//div[@id='${id}']/p`
    let paragraphs = getNodeByXpath(p_xpath, xml_text)
    let parsed_page = { id: id, paragraphs: paragraphs }
    if (img.length > 0) {
      parsed_page['img'] = img[0].nodeValue;
    }
    if(p.attributes)parsed_page["attributes"]=p.attributes;
    return parsed_page
  });
  return parsed_pages
}
/**
 * Return sentences from TEI xml file
 * @param {string} - the path to the TEI file
 */
export function parseTEI(path: string): Page[] { 
  return parseTEIString(getXML(path));
}



/**
 * Return useful data from SMIL xml file
 * @param {string} - the path to the SMIL file
 */
export function parseSMIL(path: string): Alignment {
  let xmlDocument = getXML(path)
  let parser = new DOMParser();
  let xml_text = parser.parseFromString(xmlDocument, "text/xml")
  let text = getNodeByXpath('/i:smil/i:body/i:par/i:text/@src', xml_text).map(x => {
    let split = x['value'].split('#');
    return split[split.length - 1]
  }
  )
  let audio_begin = getNodeByXpath('/i:smil/i:body/i:par/i:audio/@clipBegin', xml_text).map(x => x['value'] * 1000)
  let audio_end = getNodeByXpath('/i:smil/i:body/i:par/i:audio/@clipEnd', xml_text).map(x => x['value'] * 1000)
  let audio_duration = []
  for (var i = 0; i < audio_begin.length; i++) {
    let duration = audio_end[i] - audio_begin[i]
    audio_duration.push(duration)
  }
  let audio = zip([audio_begin, audio_duration])
  let result = {}
  for (var i = 0; i < text.length; i++) {
    result[text[i]] = audio[i]
  }
  return result
}

