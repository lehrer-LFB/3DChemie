# 3D-Chemie – Reaktionen in VR

**Online:** https://chemie-vr.das-rsg.de

Schüler:innen greifen in VR (Meta Quest, Pico) oder am Rechner Moleküle, drehen sie und
bringen ihre reaktiven Zentren zusammen. Dann läuft der Reaktionsmechanismus animiert ab.

**Beispiel:** säurekatalysierte Veresterung von Ethansäure mit Ethanol und als Rückreaktion
die säurekatalysierte Esterhydrolyse.

Beim Start wird die **Stufe** gewählt (später über „Stufe ⇄“ wechselbar):

* **EF (Einführungsphase):** Säure, Alkohol und H⁺ müssen gleichzeitig zusammengebracht werden.
  Eine kurze Animation zeigt dann: Wasser wird abgespalten, der Ester entsteht, H⁺ wird wieder
  frei. Es gibt keine Einzelschritte, keine Elektronenpfeile und keine Namen für Zwischenstufen.
* **Q2 (Qualifikationsphase):** Reaktionsmenü mit mehreren Mechanismen (siehe unten). Bei der
  Veresterung: vollständiger Mechanismus in fünf Schritten. Nach der
  Protonierung liegt das Carbonyl-C als **Carbenium-Ion** vor: Die C–O-Bindung ist nur noch
  einfach, und das C trägt formal die positive Ladung. Darauf folgen das tetraedrische
  Zwischenprodukt, die Protonenwanderung, die Abspaltung (wieder über das Carbenium-Ion) und
  die Deprotonierung, bei der sich C=O zurückbildet. **Partialladungen δ+/δ−** werden an allen
  polaren Bindungen neutraler Moleküle angezeigt (abschaltbar).

## Starten

```bash
npm start          # = node serve.mjs  (keine Installation nötig, nur Node.js)
npm test           # Headless-Test der Chemie-Logik
```

* **Am Mac:** http://localhost:8080
* **In der VR-Brille** (gleiches WLAN): die angezeigte Adresse `https://<IP>:8443` im
  Browser der Brille öffnen. Das Zertifikat ist selbstsigniert, deshalb einmal
  „Erweitert → Trotzdem fortfahren“ wählen. Danach auf **„ENTER VR“** tippen.

Falls WebXR mit dem selbstsignierten Zertifikat nicht startet, gibt es zwei Alternativen:
1. **USB + adb (Quest):** `adb reverse tcp:8080 tcp:8080`, dann in der Brille
   `http://localhost:8080` öffnen. localhost gilt als sicher.
2. **Online stellen:** Den Ordner bei einem statischen Hoster mit echtem HTTPS ablegen
   (GitHub Pages, Netlify Drop o. ä.). Das ist für den Unterricht mit den Pico-Brillen
   ohnehin der einfachste Weg, denn alle öffnen dann nur eine URL.

Zum Testen am Rechner ohne Brille eignet sich auch die Browser-Erweiterung
„Immersive Web Emulator“ (Meta).

## Bedienung

| | Desktop / Smartboard | VR |
|---|---|---|
| Molekül greifen & bewegen | Atom anklicken und ziehen | Trigger/Pinch auf ein Atom (auch per Strahl aus der Ferne) oder Grip-Taste in der Nähe |
| Molekül drehen | Rechtsklick oder Shift + ziehen | Hand drehen |
| Molekül heranholen/wegschieben | – | Thumbstick vor/zurück (bei Strahl-Griff) |
| Ansicht drehen / Zoom | Hintergrund ziehen / Mausrad | Um die Moleküle herumgehen (Spielbereich „Roomscale“). Oder: Thumbstick links/rechts dreht den Molekülraum in 30°-Schritten; **Grip-Taste ins Leere** greift den ganzen Molekülraum (eine Hand: verschieben, beide Hände: drehen und durch Auseinanderziehen zoomen, 1 Å = 4–40 cm) |
| Ansicht zurücksetzen | – | Panel „Ansicht zurücksetzen“ (auch automatisch bei jedem Neustart/Reaktionswechsel und beim Verlassen von VR) |

**Startansicht:** Jede Szene wird beim Laden automatisch mittig vor der Person platziert (`src/framing.js`):
immer derselbe Maßstab (1 Å = 10 cm), Szenenmitte auf 1,15 m Höhe, vorderstes Atom mindestens 45 cm entfernt.
| Nächster Schritt (Schrittmodus) | Leertaste oder „Weiter ▶“ | A/X-Taste oder Panel |
| Menü | Leiste unten | Panel links vorne (mit dem Strahl antippen) |
| Steuerungshilfe ein/aus | Taste H oder „ausblenden“ / „? Steuerung“ | – |

### Reaktionen in Q2

| Reaktion | Beispiel | Ablauf in der App |
|---|---|---|
| Veresterung & Hydrolyse | Ethansäure + Ethanol (H⁺) | H⁺ an den Carbonyl-O, dann den Alkohol bzw. das Wasser an das Carbenium-C |
| SN1 | 2-Brom-2-methylpropan + Wasser | Wasser an das **Br** führt zur Heterolyse (Carbenium-Ion). Danach Wasser an das C⁺ (Angriff, Deprotonierung durch weiteres Wasser). Alternativ Wasser an ein β-H: Eliminierung (Konkurrenz E1) |
| E1 (LK) | 2-Methylpropan-2-ol / H₃O⁺ | H₃O⁺ an das OH führt zur Protonierung, dann zur Wasserabspaltung (Carbenium-Ion). Danach Wasser an ein β-H: 2-Methylpropen |
| SN2 (LK) | Brommethan bzw. (R)-2-Brombutan + OH⁻ | OH⁻ von der **Rückseite** (grüne Zielkugel, gegenüber dem Br) an das C führt zum Übergangszustand mit halben Bindungen (trigonal-bipyramidal), dann zur Walden-Umkehr. Beim chiralen Beispiel wechselt das R/S-Schild am Stereozentrum. Angriff von vorne: Hinweis |
| Elektrophile Addition | Ethen + Brom | Br₂ an die Mitte der C=C-Bindung: Ab etwa 3,8 Å erscheint die induzierte Polarisierung Brδ+–Brδ−. Daraus wird der π-Komplex, dann das Bromonium-Ion (Dreiring, Br⁺) und Br⁻. Danach Br⁻ von der **Gegenseite** (grüne Markierung) an ein C: Anti-Addition zu 1,2-Dibromethan. Von der Br⁺-Seite: Hinweis |
| Radikalische Substitution | Methan + Brom, UV-Licht | Br₂ in den violetten **Lichtkegel**: Homolyse zu 2 Br•. Dann Br• an ein H des Methans: HBr + •CH₃ (planar). Dann •CH₃ an ein Br₂: CH₃Br + neues Br•, die Kette läuft weiter. Treffen zwei Radikale aufeinander: Kettenabbruch (Br₂, CH₃Br oder Ethan). Halbpfeile (Fischhaken), Radikale mit Elektronenpunkt. Zähler für Produkte, Kettenschritte und Abbrüche |
| Elektrophile aromatische Substitution (LK) | Benzol + Brom, FeBr₃ | Br₂ an das **Fe** des FeBr₃: Lewis-Säure-Komplex Brδ+–Br⁺–Fe⁻Br₃. Dann das δ+-Br an den Benzolring: π-Komplex, dann σ-Komplex (Arenium-Ion, „+“ in der Ringmitte, ortho/para orange). Dann ein Br des FeBr₄⁻ an das H am sp³-C: Rearomatisierung zu Brombenzol + HBr, FeBr₃ zurückgebildet. Ohne FeBr₃: Hinweis. Aromatische Bindungen haben die Ordnung 1,5 (1,40 Å, zweite Linie halb transparent) |

**π-Elektronen:** Benzolringe zeigen standardmäßig das Ringsymbol (Kreis). Im σ-Komplex wird daraus ein
Halbkreis mit „+“. Bei der Addition und der aromatischen Substitution blendet der Schalter
**„π-Elektronenwolke“** die delokalisierte π-Wolke ein: zwei Ringe ober- und unterhalb des Benzolrings,
die sich im σ-Komplex am sp³-C öffnen, bzw. zwei Keulen an der C=C-Doppelbindung des Ethens, die bei der
Bromonium-Bildung verschwinden. Alles folgt automatisch den Bindungsordnungen (URL-Option `&pi`).

Die Markierung **LK** steht zentral in `src/reactions/index.js` bzw. in den Reaktionsmodulen
(`static lk`) und ist vorläufig. Bitte mit dem Kernlehrplan abgleichen.

**Ablauf Veresterung (EF):** H⁺ (blau) und die OH-Gruppe des Ethanols (grün) an die
Carboxygruppe (gelb) bringen. Die Reihenfolge ist egal. Die Reaktion startet erst, wenn alle drei
beisammen sind.

**Ablauf Veresterung (Q2):** H⁺ (blau) an den Carbonyl-Sauerstoff (gelb) bringen. Danach ist das
Carbonyl-C aktiviert (orange). Jetzt den Ethanol-Sauerstoff (grün) an dieses C bringen.
Daraufhin laufen Angriff, Protonenwanderung, Wasserabspaltung und Deprotonierung automatisch ab.
**Hydrolyse:** dasselbe mit Ester, H⁺ und Wasser (z. B. dem Wasser, das gerade entstanden ist).

**Didaktische Schalter**
* **Schrittmodus:** Die Animation hält vor jedem Schritt an. Die Elektronenpfeile sind dann
  schon zu sehen, so können die Schüler:innen eine Vorhersage treffen.
* **Elektronenpfeile:** Pfeile vom Elektronenpaar zum Ziel, vor jedem Schritt.
* **¹⁸O-Markierung:** Färbt den Sauerstoff des Ethanols (Veresterung) bzw. des Wassers
  (Hydrolyse-Szenario) orange. Man sieht so, wo das Atom landet (klassisches
  Isotopenexperiment, Spaltung der Acyl-O-Bindung).
* **Vorführen ▶▶:** Führt die nächste mögliche Reaktion automatisch vor (Beamer).
* **Ohne Katalysator** gibt es keine Reaktion, sondern einen Hinweis. Ein falsches Nukleophil
  (z. B. Ethanol an den protonierten Ester) wird ebenfalls erklärt.

URL-Parameter: `?level=ef` bzw. `?level=q2` überspringt die Startauswahl, `?reaction=sn1` (bzw. `sn2`, `e1`, `addition`, `radical`, `sear`,
`esterification`) startet direkt eine Reaktion, `&scenario=chiral` wählt ein Szenario, `?panel` blendet das VR-Panel am Rechner ein, `?demo=2` führt Veresterung und Hydrolyse nacheinander vor, `&o18` schaltet die
Markierung ein, `&t=12` spult 12 s vor (für Screenshots).

## Aufbau

```
index.html          Seite, Import-Map (Three.js 0.160 vom CDN)
serve.mjs           Entwicklungs-Server (HTTP + HTTPS mit Selbstzertifikat)
src/sim.js          Chemie-Kern: Atome, Bindungen, Kraftfeld (Position Based Dynamics)
src/mechanism.js    Ablauf-Engine (Schritte: Pfeile → Bindungen umbauen → Pause)
src/reactions/      Reaktionsmodule: Erkennungsregeln, Schritte, Texte, Szenarien, Vorführung
                    (index.js = Menü-Verzeichnis, base.js = gemeinsame Hilfen,
                     carbenium.js = gemeinsame Logik von SN1/E1)
src/molecules.js    Molekülvorlagen, Szenarien, Namen
src/view.js         Three.js-Darstellung (Kugel-Stab, Ladungen, Halos, Pfeile, Namen)
src/input.js        Maus/Touch und WebXR-Controller/Handtracking
src/ui.js           HTML-Overlay und VR-Panel
src/conformer.js    Konformationssuche (Drehung um Einfachbindungen)
src/framing.js      Startansicht je Szene (mittig, gleicher Maßstab, Mindestabstand)
src/demo.js         Automatische Vorführung
test/run.mjs        Headless-Test (Node), ohne Browser
test/xr-view.html   Browser-Test der VR-Ansichtssteuerung (simulierte Hände)
```

**Wie die Animation entsteht:** Es gibt keine vorgefertigten Keyframes. Jede Bindung hat eine
Bindungsordnung, die über die Zeit animiert wird (0 → 1 entsteht, 2 → 1 klappt auf …). Ein kleines
Kraftfeld leitet daraus in jedem Frame Bindungslängen und Bindungswinkel ab (sp³ 109,5°, sp² 120°,
Wasser 104,5° …). Die Atome bewegen sich deshalb von selbst plausibel, und das tetraedrische
Zwischenprodukt entsteht ohne Handarbeit.

**Konformationen:** Nach jeder Reaktion drehen sich die Produkte sichtbar um ihre Einfachbindungen in die
energetisch günstigste Konformation (`src/conformer.js`). Startmoleküle liegen sofort so vor. Das Modell
ist bewusst einfach: Torsionsbarriere für sp³–sp³-Bindungen (gestaffelt), syn/Z-Präferenz für O=C–O–X
(Carbonsäure, Ester) und sterische Abstoßung. Daraus ergeben sich z. B. der Z-Ester mit anti-stehender
Ethylgruppe, die syn-Carbonsäure, gestaffeltes Ethan-/Butan-Gerüst und anti-1,2-Dibromethan.

**Wie Reaktionen erkannt werden:** Die Regeln arbeiten auf dem Bindungsgraphen und nicht auf
festen Atomen. Sie erkennen z. B. „Carbonyl-C mit C=O und O–H, Sauerstoff protoniert“ oder
„O mit genau einem H und einem sp³-C = Alkohol“. Deshalb funktionieren nachgelegte Edukte
(„+ Edukte“) und Hin- und Rückreaktion mit demselben Code.

## Nächste Schritte / Ideen

* **Gleichgewichts-Duell (zwei Personen):** Person A bekommt laufend neue Edukte und verestert,
  Person B hydrolysiert die entstandenen Ester. Die Konzentrationen werden als Zeitverlauf
  dargestellt. Vorbereitet sind schon: `spawnReactants()`, die Zähler
  `mech.counts.ester/hydrolysis` und die Fragment-Erkennung per Summenformel.
  Für den Mehrspielerbetrieb wäre zusätzlich ein kleiner WebSocket-Server nötig.
* Weitere Reaktionen als neue Module in `src/reactions/` (z. B. Verseifung).
* Partialladungen (δ+/δ−) und freie Elektronenpaare als optionale Ebene.
* Three.js lokal ablegen statt vom CDN, damit die Anwendung offline im Schulnetz läuft.

## Mitmachen

Fehler in der Chemie, Ideen für neue Reaktionen oder Verbesserungen für den Unterricht gern als
[Issue](../../issues) melden. Eine neue Reaktion ist ein eigenes Modul in `src/reactions/`
(Vorlage: ein vorhandenes Modul, Eintrag in `src/reactions/index.js`). Vor einem Pull Request
bitte `npm test` ausführen.

## Lizenz

* **Programmcode** (inklusive der in den Reaktionsmodulen enthaltenen Texte): [MIT-Lizenz](LICENSE)
* **Dokumentation** (diese README, Screenshots): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.de),
  Namensnennung: Daniel von Laufenberg, Rhein-Sieg-Gymnasium

Verwendete Bibliothek: [three.js](https://threejs.org) 0.160 (MIT-Lizenz), wird vom CDN geladen.
