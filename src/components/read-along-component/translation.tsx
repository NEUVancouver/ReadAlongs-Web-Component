export type InterfaceLanguage = "eng" | "fra";//iso 639-3 code
export type Translation = {
    [lang in InterfaceLanguage]: string;
  };
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
export const returnTranslation = (word: string, lang?: InterfaceLanguage, defaultLanguage: InterfaceLanguage = 'eng'): string => {
    if (lang === undefined) lang = defaultLanguage;
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
        },
        "zoom-waveform": {
            "eng": "Zoom Waveform",
            "fra": "agrandir la forme d'onde"
        }
    }
    if (translations[word])
        return translations[word][lang]
    return word;
}
