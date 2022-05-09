/**
 * A Configuration menu that allows the user to specify a *.map file
 * and a *.svg to build a world off of. This FormApplication will parse
 * the map file for all relevant information, and build a new scene to
 * represent all of the data gathered. Additionally will store data in
 * Journal Entries in order to make future referencing easier.
 */
class LoadAzgaarMap extends FormApplication {
    constructor(...args) {
        super(...args);
        game.users.apps.push(this);
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            title: "Load Azgaar's Map",
            id: "rwk-afmg",
            template: "modules/rwk-afmg/templates/loadAzgaarsMap.html",
            closeOnSubmit: true,
            popOut: true,
            width: 500,
            height: 710,
            tabs: [{ navSelector: ".tabs", contentSelector: ".content", initial: "main" }],
        });
    }
    /**
     * @return {object}    Object that contains all information necessary to render template.
     */
    async getData() {
        return {};
    }

    render(force, context = {}) {
        return super.render(force, context);
    }

    /**
     * Activate all of the listener's for the form, both Foundry
     * and custom ones.
     *
     * @param  {DOM} html    DOM of the Form Application (template)
     */
    activateListeners(html) {
        super.activateListeners(html);
        // Parse map whenever the file input changes.
        html.find("#map").change((event) => this.parseMap(event));
        // Trigger FilePicker for icon selection
        html.find("#azgaar-icon-select img").click((event) => this._onEditImage(event));

        html.find("#azgaar-map-select input[name='pictureMap']").change(async (event) => {
            const picture = $(event.currentTarget).val();
            let picWidth = 0;
            let picHeight = 0;

            await fetch(picture).then(async (response) => {
                return new Promise((resolve) => {
                    let sceneImg = new Image();
                    sceneImg.onload = () => {
                        picWidth = sceneImg.width;
                        picHeight = sceneImg.height;

                        this.picWidth = picWidth;
                        this.picHeight = picHeight;

                        // Enable submit button now that picture is loaded
                        html.find("button[type='submit']").prop("disabled", false);
                        resolve();
                    };

                    sceneImg.src = response.url;

                    // Disable submit button while picture is loading
                    html.find("button[type='submit']").prop("disabled", true);
                });
            });
        });

        // Update text based on input value.
        html.find("#azgaar-pin-fixer-select input[type=range]").change((event) => {
            const sVal = $(event.currentTarget).val();
            const zoomSpan = $(event.currentTarget).siblings("span");
            if (zoomSpan[0].id.includes("minZoomValue")) {
                zoomSpan.text("Min Zoom Level: " + sVal);
            } else {
                zoomSpan.text("Max Zoom Level: " + sVal);
            }
        });

        // Revert to default zoom levels
        html.find("#azgaar-pin-fixer-select button").click((e) => {
            const defaults = [1, 2, 0.1, 2, 2, 3];
            html.find("#azgaar-pin-fixer-select .flexcol").each((i, event) => {
                if (i % 2 == 0) {
                    $(event)
                        .find("span")
                        .text("Min Zoom Level: " + defaults[i]);
                } else {
                    $(event)
                        .find("span")
                        .text("Max Zoom Level: " + defaults[i]);
                }
                $(event).find("input").val(defaults[i]);
            });
        });

        // Revert to default of "Observer" for all permission configs.
        html.find("#azgaar-permissions-select #permissionDefaults").click((e) => {
            html.find("#azgaar-permissions-select #permission-groups #permission2,#permission6,#permission10").each(
                (i, event) => {
                    $(event).prop("checked", "checked");
                }
            );
        });
    }

    static async compendiumUpdater(compType, contentSchema, baseData, extraData) {
        // Assumptions for updating
        // 1. Same number of entities (be it is, countries, burgs, whatever)
        // 2. all entities already exist (no new ones!)
        if (!baseData) return;

        let comp;
        let oldIds = [];
        /* if there is already a compendium... */
        if (game.packs.get("world." + compType)) {
            // empty the content
            const oldCComp = game.packs.get("world." + compType);
            const oldCCompContent = await oldCComp.getDocuments();
            let jIds = oldCCompContent.map((journal) => journal.id);
            oldIds = jIds;
            comp = oldCComp;
        }
        /* there is no compendium with this name */
        else {
            comp = await CompendiumCollection.createCompendium({ name: compType, label: compType, entity: "JournalEntry" });
        }

        baseData.shift(); // remove first element, usually blank or a "remainder".
        let compData = await Promise.all(
            baseData.map(async (i) => {
                // items that have been removed are missing some properties that cause failures
                // but these are signified by having a "removed" property on them with a value
                // of true
                if (!jQuery.isEmptyObject(i)) {
                    if (!("removed" in i && i.removed === true)) {
                        let content = await renderTemplate("modules/rwk-afmg/templates/" + contentSchema, {
                            iter: i,
                            extras: extraData,
                        });
                        if (i.name) {
                            let journal = {
                                content: content,
                                name: i.name,
                                flags: {
                                    "rwk-afmg": {
                                        "compendiumEntry": true,
                                    }
                                }

                            };
                            if (oldIds.length === 0) {
                                journal.permission = { default: CONST.ENTITY_PERMISSIONS.OBSERVER };
                            }
                            return journal;
                        }
                    }
                }
            })
        );

        compData = compData.filter(Boolean); // apparently some items can still be undefined at this point

        if (oldIds.length) {
            let updates = compData.map((cJournal, index) => {
                cJournal._id = oldIds[index];
                return cJournal;
            });
            await JournalEntry.updateDocuments(updates, { pack: "world." + compType });
        } else {
            await JournalEntry.createDocuments(compData, { pack: "world." + compType });
        }

        return comp;
    }

    /**
     * Load map file as text
     *
     * @param  {event} event    triggered by change of the "map" input
     * @return {Promise}        resolve once file is loaded.
     */
    loadMap(event) {
        return new Promise((resolve, reject) => {
            let input = $(event.currentTarget)[0];
            let fr = new FileReader();
            let file = input.files[0];

            fr.onload = () => {
                resolve(fr.result);
            };
            fr.readAsText(file);
        });
    }

    /**
     * Adhering to the data format of FMG, extract all valuable information
     * and save it to Memory.
     *
     * @param  {event} event    triggered by change of the "map" input
     * @return {Promise}        resolve() once all parsing is done
     */
    async parseMap(event) {
        // Load the file
        let text = await this.loadMap(event);
        /* Data format as presented in v1.4 of Azgaar's Fantasy Map Generator
    const data = [params, settings, coords, biomes, notesData, svg_xml,
      gridGeneral, grid.cells.h, grid.cells.prec, grid.cells.f, grid.cells.t, grid.cells.temp,
      features, cultures, states, burgs,
      pack.cells.biome, pack.cells.burg, pack.cells.conf, pack.cells.culture, pack.cells.fl,
      pop, pack.cells.r, pack.cells.road, pack.cells.s, pack.cells.state,
      pack.cells.religion, pack.cells.province, pack.cells.crossroad, religions, provinces,
      namesData, rivers].join("\r\n");
    */

        /* We are interested in the following fields, so extract them smartly (since order may change)
    Biomes: Biomes of the world (?)
    Cultures: Cultures
    States: Countries
    Burgs: Cities
    Religions: Relgions of the world
    Provinces: Group of Burgs in States
    namesData: Real world basis (culture) for countries/cultures.
    Rivers: Rivers
    */
        // Turn file into array of lines
        const lines = text.split(/[\r\n]+/g);

        // FMG Settings
        let firstLine = lines[0].split("|");
        // Extract FMG seed
        this.seed = firstLine[3];
        // Extract image size
        this.mapWidth = firstLine[4];
        this.mapHeight = firstLine[5];

        lines.forEach((line) => {
            try {
                // Only interested in JSON objects
                const obj = JSON.parse(line);

                /**
                 * Each JSON object is one of the following categories
                 * so here we determine which one it is, then assign
                 * the proper variables to it.
                 */

                // Provinces
                if ("state" in obj[1] && !("cell" in obj[1])) {
                    console.log("Provinces:", obj);
                    this.provinces = obj || [];
                } // Burgs
                else if ("population" in obj[1] && "citadel" in obj[1]) {
                    console.log("Burgs:", obj);
                    this.burgs = obj;
                }
                // These are our countries
                else if ("diplomacy" in obj[0]) {
                    console.log("Countries:", obj);
                    this.countries = obj;
                    // Religions
                } else if (obj[0].name === "No religion") {
                    console.log("Religions:", obj);
                    this.religions = obj;
                    // Cultures
                } else if (obj[0].name === "Wildlands") {
                    console.log("Cultures:", obj);
                    this.cultures = obj;
                    // Rivers
                } else if ("mouth" in obj[0]) {
                    console.log("Rivers:", obj);
                    this.rivers = obj;
                }
                // Many things in the file are not JSON, we don't care about them.
            } catch (error) { }
        });
    }

    /**
     * This method takes the data from memory and creates readable Journal
     * Entries out of it.
     *
     * @return {Promise}    resolve once all Foundry creations are done.
     */
    async importData() {
        return new Promise(async (resolve, reject) => {
            /**
             * Cultures
             */
            ui.notifications.notify("UAFMGI: Creating Journals for Cultures.");
            this.cultureComp = await LoadAzgaarMap.compendiumUpdater("Cultures", "culture.hbs", this.cultures, {});

            let cultureLookup = this.cultures.map((culture) => {
                return {
                    id: culture.i,
                    name: culture.name,
                    journal: this.retrieveJournalByName({ type: "culture", name: culture.name }),
                };
            });

            /**
             * Provinces
             */
            let provinceLookup = [];
            if (this.provinces) {
                ui.notifications.notify("UAFMGI: Creating Journals for Provinces.");
                this.provinceComp = await LoadAzgaarMap.compendiumUpdater("Provinces", "province.hbs", this.provinces, {});
                provinceLookup = this.provinces.map((province) => {
                    return {
                        id: province.i,
                        name: province.name,
                        burgs: province.burgs,
                        journal: this.retrieveJournalByName({ type: "province", name: province.name }),
                    };
                });
            }

            /**
             * Countries
             */
            ui.notifications.notify("UAFMGI: Creating Journals for Countries.");

            let countryData = this.countries.map((country) => {
                if (!(jQuery.isEmptyObject(country) || country.name === "Neutrals")) {
                    // TODO: Extrapolate Provinces, add Burgs?, Neighbors, Diplomacy, Campaigns?, Military?
                    let culture = cultureLookup[country.culture - 1];
                    country.culture = culture;
                    // Removed countries are still in Diplomacy as an X
                    if (country.diplomacy) {
                        country.diplomacy = country.diplomacy.filter((c) => c !== "x");
                    }
                    // for i in country.provinces
                    // map to actual province
                    if (this.provinces) {
                        let provinces = country.provinces?.map((provIndex) => provinceLookup[provIndex]);
                        country.selProvinces = provinces;
                    }
                }
                return country;
            });

            // ignore removed countries
            const renderCountryData = countryData.filter((c) => !c.removed);

            // We provide countryData a 2nd time in the "extraData" field because the "baseData"
            // field gets trimmed to a single entity when rendering.
            this.countryComp = await LoadAzgaarMap.compendiumUpdater("Countries", "country.hbs", renderCountryData, {
                countries: renderCountryData,
            });

            let countryLookup = this.countries.map((country) => {
                return {
                    id: country.i,
                    name: country.name,
                    journal: this.retrieveJournalByName({ type: "country", name: country.name }),
                };
            });

            /**
             * Burgs
             */
            ui.notifications.notify("UAFMGI: Creating Journals for Burgs.");
            const burgData = this.burgs.map((burg, i) => {
                if (burg !== 0 && !jQuery.isEmptyObject(burg)) {
                    burg.culture = cultureLookup[burg.culture - 1];
                    burg.country = countryLookup[burg.state];
                    burg.province = provinceLookup.find((province) => province.burgs?.includes(burg.i));
                    burg.burgURL = this.generateBurgURL(burg, i);
                }
                return burg;
            });

            this.burgComp = await LoadAzgaarMap.compendiumUpdater("Burgs", "burg.hbs", burgData, {});

            const burgLookup = this.burgs.map((burg, i) => {
                return {
                    id: burg.i,
                    name: burg.name,
                    journal: this.retrieveJournalByName({ type: "burg", name: burg.name }),
                };
            });

            // We have a circular dependency on everything so provinces kinda get shafted in the initial journals
            // so here we update them to hold all sorts of information

            if (this.provinces) {
                const provinceData = this.provinces.map((province, i) => {
                    if (province !== 0 && !jQuery.isEmptyObject(province)) {
                        province.country = countryLookup[province.state];
                        province.burgs = province.burgs?.map((id) => burgLookup[id]);
                    }
                    return province;
                });
                this.provinceComp = await LoadAzgaarMap.compendiumUpdater("Provinces", "province.hbs", provinceData, {});
            }

            resolve();
        });
    }

    /**
     * Make a new scene with the picture as the background
     *
     * @param  {string} picture    File path to the picture asset
     * @return {Scene}         New Scene to work on
     */
    async makeScene(picture) {
        return new Promise(async (resolve, reject) => {
            let sceneName = picture.split("%20")[0].split(".(svg|png|jpg|jpeg|webm)")[0];

            const ogWidth = parseInt(this.mapWidth);
            const ogHeight = parseInt(this.mapHeight);

            const newWidth = this.picWidth;
            const newHeight = this.picHeight;

            const widthMultiplier = newWidth / ogWidth;
            const heightMultiplier = newHeight / ogHeight;

            //Create The Map Scene
            let sceneData = await Scene.create({
                name: sceneName,
                width: this.picWidth,
                height: this.picHeight,
                padding: 0.0,
                img: picture,
                // Flags for making pinfix work immediately.
                "flags.pinfix.enable": true,
                "flags.pinfix.minScale": 1,
                "flags.pinfix.maxScale": 1,
                "flags.pinfix.zoomFloor": 0.1,
                "flags.pinfix.zoomCeil": 3,
                "flags.pinfix.hudScale": 1,
            });

            await sceneData.activate();

            resolve([sceneData, widthMultiplier, heightMultiplier]);
        });
    }

    /**
     * Handle changing the icons by opening a FilePicker
     * @private
     */
    _onEditImage(event) {
        const fp = new FilePicker({
            type: "image",
            callback: (path) => {
                event.currentTarget.src = path;
            },
            top: this.position.top + 40,
            left: this.position.left + 10,
        });
        return fp.browse();
    }

    /**
     * Find an object by searching through compendiums (Foundry db)
     *
     * @param  {String} type    Type of object to find
     * @param  {String} name    Name of object to find
     * @return {object}         Found Object
     */
    retrieveJournalByName({ type = "burg", name = "" }) {
        let searchable;
        if (type === "burg") {
            searchable = this.burgComp;
        } else if (type === "country") {
            searchable = this.countryComp;
        } else if (type === "culture") {
            searchable = this.cultureComp;
        } else if (type === "province") {
            searchable = this.provinceComp;
        }

        let journal = searchable.find((elem) => elem.name === name);

        return journal;
    }

    generateBurgURL(burg, id) {
        id = id.toString();
        const seed = this.seed + id.padStart(4, 0);
        const site = "http://fantasycities.watabou.ru/?random=0&continuous=0";
        const pop = ("" + burg.population).replace(".", "");
        const url = `${site}&name=${burg.name
            }&population=${+pop}&size=${+burg.size}&seed=${seed}&coast=${+burg.coast}&citadel=${+burg.citadel}&plaza=${+burg.plaza}&temple=${+burg.temple}&walls=${+burg.walls}&shantytown=${+burg.shanty}`;
        return url;
    }

    /**
     * Automatically called by Foundry upon submission of FormApplication
     * Controls the process of creating everything. Scene, data, notes, etc.
     *
     * @param  {event} event        event that triggered this call, usually a click
     * @param  {String} formData    HTML of the form that was submitted
     * @return {None}               Foundry expects it to return something.
     */
    async _updateObject(event, formData) {
        // Make a journal entry to tie fake notes to or find the old one
        // If no "real" journal entry is provided than the map notes fail
        // to show up, hence why this block of code exists.

        // TODO: Investigate better way than adding a random journal entry.
        let azgaarJournal = game.journal.getName("Azgaar FMG");
        if (!azgaarJournal) {
            let fakeJournal = {
                content: `This journal entry is necessary for the azgaar-foundry importer to work properly. 
                          Please check the world's compendiums for your world's contents.
                          If you are not the GM, then you are not allowed to view the contents of the Note
                          you have selected.`,
                name: "Azgaar FMG",
                permission: { default: 2 },
            };
            azgaarJournal = await JournalEntry.create(fakeJournal);
        }

        // Make the scene
        let picture = this.element.find('[name="pictureMap"]').val();
        if (!picture) {
            ui.notifications.error("[Azgaar FMG] You must attach a picture and a map file to the form.");
            return;
        }
        let [scene, widthMultiplier, heightMultiplier] = await this.makeScene(picture);
        AzgaarFM.widthMultiplier = widthMultiplier;
        AzgaarFM.heightMultiplier = heightMultiplier;

        // get icons to use for notes
        const burgSVG = this.element.find("#burgSVG").attr("src");
        const countrySVG = this.element.find("#countrySVG").attr("src");
        const provinceSVG = this.element.find("#provinceSVG").attr("src");

        // get permissions to use
        const burgPerm = parseInt(this.element.find("[name='permissionBurg']:checked").val());
        const countryPerm = parseInt(this.element.find("[name='permissionCountry']:checked").val());
        const provincePerm = parseInt(this.element.find("[name='permissionProvince']:checked").val());
        // import our data
        await this.importData();

        const [countryMinZoom, countryMaxZoom] = this.element
            .find("#azgaar-pin-fixer-select #countriesScaling input")
            .map((i, input) => input.value);

        let useColor = this.element.find("#azgaar-icon-select #countriesIcon input#iconColorsCountries").is(":checked");
        // Start prepping notes
        let countryData = this.countries.map((country) => {
            if (country.name === "Neutrals") return;
            if (country.removed) return;
            let journalEntry = this.retrieveJournalByName({
                type: "country",
                name: country.name,
            });
            if (!journalEntry) return;

            let xpole,
                ypole = 0;
            if (country.pole) {
                xpole = country.pole[0];
                ypole = country.pole[1];
            }

            // Assemble data required for notes
            return {
                entryId: azgaarJournal.id,
                x: xpole * widthMultiplier,
                y: ypole * heightMultiplier,
                icon: countrySVG,
                iconSize: 32,
                iconTint: useColor ? country.color : "#00FF000",
                text: country.name,
                fontSize: 24,
                textAnchor: CONST.TEXT_ANCHOR_POINTS.CENTER,
                textColor: "#00FFFF",
                "flags.pinfix.minZoomLevel": countryMinZoom,
                "flags.pinfix.maxZoomLevel": countryMaxZoom,
                "flags.rwk-afmg.journal": { compendium: "world.Countries", id: journalEntry?.id },
                "flags.rwk-afmg.permission": { default: countryPerm },
            };
        });

        const [provinceMinZoom, provinceMaxZoom] = this.element
            .find("#azgaar-pin-fixer-select #provincesScaling input")
            .map((i, input) => input.value);

        useColor = this.element.find("#azgaar-icon-select #provincesIcon input#iconColorsProvinces").is(":checked");
        let provinceData = [];
        if (this.provinces) {
            provinceData = this.provinces.map((province) => {
                if (province === 0 || province.removed) return; // For some reason there's a 0 at the beginning.
                let journalEntry = this.retrieveJournalByName({
                    type: "province",
                    name: province.name,
                });
                if (!journalEntry) return;

                // Some provinces do not have a burg... For now we skip those.
                if (province.burg === 0) return;
                let centerBurg = this.burgs.find((burg) => burg.i === province.burg);

                // Assemble data required for notes
                return {
                    entryId: azgaarJournal.id,
                    x: centerBurg.x * widthMultiplier,
                    y: centerBurg.y * heightMultiplier,
                    icon: provinceSVG,
                    iconSize: 32,
                    iconTint: useColor ? province.color : "#00FF000",
                    text: province.name,
                    fontSize: 24,
                    textAnchor: CONST.TEXT_ANCHOR_POINTS.CENTER,
                    textColor: "#00FFFF",
                    "flags.pinfix.minZoomLevel": provinceMinZoom,
                    "flags.pinfix.maxZoomLevel": provinceMaxZoom,
                    "flags.rwk-afmg.journal": { compendium: "world.Provinces", id: journalEntry?.id },
                    "flags.rwk-afmg.permission": { default: provincePerm },
                };
            });
        }

        const [burgMinZoom, burgMaxZoom] = this.element
            .find("#azgaar-pin-fixer-select #burgsScaling input")
            .map((i, input) => input.value);

        useColor = this.element.find("#azgaar-icon-select #burgsIcon input#iconColorsBurgs").is(":checked");
        let burgData = this.burgs.map((burg) => {
            if (jQuery.isEmptyObject(burg)) return; // For some reason there's a {} at the beginning.
            if (burg.removed) return;
            let journalEntry = this.retrieveJournalByName({ name: burg.name });
            if (!journalEntry) return; // First burg = 0

            // Assemble data required for notes
            return {
                // entryId must be a valid journal entry (NOT from compendium, otherwise things really break.)
                entryId: azgaarJournal.id,
                x: burg.x * widthMultiplier,
                y: burg.y * heightMultiplier,
                icon: burgSVG,
                iconSize: 32,
                iconTint: useColor ? burg.color : "#00FF000",
                text: burg.name,
                fontSize: 24,
                textAnchor: CONST.TEXT_ANCHOR_POINTS.CENTER,
                textColor: "#00FFFF",
                "flags.pinfix.minZoomLevel": burgMinZoom,
                "flags.pinfix.maxZoomLevel": burgMaxZoom,
                "flags.rwk-afmg.journal": { compendium: "world.Burgs", id: journalEntry?.id },
                "flags.rwk-afmg.permission": { default: burgPerm },
            };
        });

        // Remove all falsy values.
        countryData = countryData.filter(Boolean);
        provinceData = provinceData.filter(Boolean);
        burgData = burgData.filter(Boolean);

        // Make all of our notes, in one call to the db.
        await canvas.scene.createEmbeddedDocuments("Note", [...countryData, ...provinceData, ...burgData]);

        ui.notifications.notify("Load Azgaar Map has finished.");
        return;
    }
}

class ResetAzgaarMap extends FormApplication {

    constructor(...args) {
        super(...args);
        console.log("RWK | ResetAzgaarMap");
    }
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            title: "Reset Azgaar Map",
            id: "rwk-afmg",
            template: "modules/rwk-afmg/templates/resetAzgaarsMap.html",
            closeOnSubmit: true,
            popOut: true,
            width: 600,
            height: 600,
        });
    }
}

class AzgaarFM {
    constructor() {
    }

    /* making this async so we can await the import Reset Map Notes */
    static async init() {
        game.settings.registerMenu("rwk-afmg", "config", {
            name: "Load Map",
            label: "Load Azgaar's Map into Foundry",
            hint: "Load Azgaar's Map into Foundry",
            icon: "fas fa-desktop",
            type: LoadAzgaarMap,
            restricted: true,
        });
        game.settings.register("rwk-afmg", "new-journal", {
            name: " Create New Journal Entry (required for Monk's Enhanced Journal)",
            scope: 'world',     // "world" = sync to db, "client" = local storage
            config: true,       // false if you dont want it to show in module config
            type: Boolean,       // Number, Boolean, String, Object
            default: {},
        });
        game.settings.registerMenu("rwk-afmg", "reset", {
            name: "Reset Map Notes",
            label: "Reset Map Notes",
            hint: "Resets notes to 'Azgaar FMG' and deletes related journals",
            icon: "fas fa-desktop",
            type: ResetAzgaarMap,
            restricted: true,
        });

        /* If Monks Enhanced Journal is active load the classes required to render it. */
        if (game.modules.get("monks-enhanced-journal")?.active) {
            await import("../monks-enhanced-journal/apps/enhanced-journal.js")
                .then(module => {
                    AzgaarFM.EnhancedJournal = module.EnhancedJournal;
                })
                .catch(err => {
                    console.error("RWK | Azgaar main.js | Getting Enhanced Journal")
                });

            await import("../monks-enhanced-journal/monks-enhanced-journal.js")
                .then(module => {
                    AzgaarFM.MonksEnhancedJournal = module.MonksEnhancedJournal;
                })
                .catch(err => {
                    console.error("RWK | Azgaar main.js | Getting Monks Enhanced Journal")
                });
        }

        this.noteToDuplicate;
        this.linkJournalId;
        this.compendiumPack;
        this.linkClicked;
        this.EnhancedJournal;
        this.MonksEnhancedJournal;
        this.pinDefault = "countriesPinDefault";

        this.pinDefaults = {
            worldPinDefault: {
                countries: {
                    minZoom: 0.1,
                    maxZoom: 2
                },
                provinces: {
                    minZoom: 1,
                    maxZoom: 2
                },
                burgs: {
                    minZoom: 2,
                    maxZoom: 3
                },
            },
            countriesPinDefault: {
                countries: {
                    minZoom: 0.1,
                    maxZoom: 0.5
                },
                provinces: {
                    minZoom: 1,
                    maxZoom: 2
                },
                burgs: {
                    minZoom: 0.5,
                    maxZoom: 3
                },
            },
            provincesPinDefault: {
                countries: {
                    minZoom: 0.1,
                    maxZoom: 0.5
                },
                provinces: {
                    minZoom: 1,
                    maxZoom: 2
                },
                burgs: {
                    minZoom: 0.5,
                    maxZoom: 3
                },
            }
        };
    }

    static async ready() {
        const notesArray = canvas.notes.placeables.filter(note => {
            if (hasProperty(note.data.flags, 'rwk-afmg') && note.entry === undefined)
                return note;
        });

        for (const note of notesArray) {
            const azgaarJournal = game.journal.getName("Azgaar FMG");
            if (azgaarJournal) {
                let data = {
                    // entryId must be a valid journal entry (NOT from compendium, otherwise things really break.)
                    entryId: azgaarJournal.id,
                };
                const cJournal = note.document.getFlag("rwk-afmg", "journal");
                note.document.update({ entry: data, entryId: azgaarJournal.id });
            }
        }
    }

    // onClickLeft2MapNote = Note.prototype._onClickLeft2;
    static async onClickLeft2MapNote(wrapped, ...args) {

        console.log("RWK |  in azgaar-foundry clickleft2");
        if (this.entry.name !== "Azgaar FMG")
            return wrapped(...args);
        const cJournal = this.document.getFlag("rwk-afmg", "journal");
        const cPerm = this.document.getFlag("rwk-afmg", "permission");
        // Technically all of our MapNotes are the default "Azgaar FMG"
        // JournalEntry, so here we check the permissions on the "real"
        // JournalEntry. As a default just let the GM through though.
        if (cJournal && (cPerm?.default >= 1 || game.user.isGM)) {
            const comp = game.packs.get(cJournal.compendium);
            let doc = await comp.getDocument(cJournal.id);
            if (game.settings.get("rwk-afmg", "new-journal")) {
                // create new journal entry with compendium entries data
                const newDoc = await JournalEntry.create(doc.data);
                await this.document.update({ entry: newDoc, entryId: newDoc.id });
                newDoc.sheet.render(true);
            } else {
                doc.sheet.render(true);
            }
        } else {
            return wrapped(...args);
        }
    }

    // onLeftClickJournalLink = TextEditor.prototype.constructor._onClickContentLink;
    static async onLeftClickJournalLink(wrapped, ...args) {
        const event = args[0];
        event.preventDefault();
        const a = event.currentTarget;

        if (a.dataset.pack) {
            AzgaarFM.linkJournalId = a.dataset.id;
            AzgaarFM.compendiumPack = a.dataset.pack;
            AzgaarFM.linkClicked = true;
        }
        return wrapped(...args);
    }

    static render(journal) {
        //if the enhanced journal is already open, then just pass it the new object, if not then let it render as normal
        if (AzgaarFM.MonksEnhancedJournal.journal) {
            if (journal)
                AzgaarFM.MonksEnhancedJournal.journal.open(journal, false);
            else
                AzgaarFM.MonksEnhancedJournal.journal.render(true);
        }
        else
            AzgaarFM.MonksEnhancedJournal.journal = new AzgaarFM.EnhancedJournal(journal).render(true);
    }

    static async renderNoteConfig(noteConfig, html, data) {

        if (!Boolean(noteConfig.document.entry.data.flags["rwk-afmg"])) return;

        let catHtml = {
            "Countries": [],
            "Provinces": [],
            "Burgs": [],
            "General": [],
        }

        let notesHtml = await renderTemplate("modules/rwk-afmg/templates/mapnotesHeader.html", {});
        for (const scene of game.scenes) {
            notesHtml += await renderTemplate("modules/rwk-afmg/templates/sceneButton.html", { data: scene });

            let template;

            for (const content of scene.notes.contents) {
                if (content.getFlag("rwk-afmg", "journal.compendium")?.includes("Countries")) {
                    if (!catHtml.Countries.find(element => element.name == content.data.text)) {
                        template = await renderTemplate("modules/rwk-afmg/templates/mapnote.html", { data: content });
                        catHtml.Countries.push({ name: content.data.text, value: template });
                    }
                }

                else if (content.getFlag("rwk-afmg", "journal.compendium")?.includes("Provinces")) {
                    if (!catHtml.Provinces.find(element => element.name == content.data.text)) {
                        template = await renderTemplate("modules/rwk-afmg/templates/mapnote.html", { data: content });
                        catHtml.Provinces.push({ name: content.data.text, value: template });
                    }
                }

                else if (content.getFlag("rwk-afmg", "journal.compendium")?.includes("Burgs")) {
                    if (!catHtml.Burgs.find(element => element.name == content.data.text)) {
                        template = await renderTemplate("modules/rwk-afmg/templates/mapnote.html", { data: content });
                        catHtml.Burgs.push({ name: content.data.text, value: template });
                    }
                }

                else {
                    if (!catHtml.General.find(element => element.name == content.data.text)) {
                        template = await renderTemplate("modules/rwk-afmg/templates/mapnote.html", { data: content });
                        catHtml.General.push({ name: content.data.text, value: template });
                    }
                }
            }

            catHtml.Countries.sort((a, b) => {
                if (a.name < b.name) return -1;
                if (a.name > b.name) return 1;
                return 0;
            });
            let countriesHtml = catHtml.Countries.map(e => e.value).join(' ');

            catHtml.Provinces.sort((a, b) => {
                if (a.name < b.name) return -1;
                if (a.name > b.name) return 1;
                return 0;
            });
            let provincesHtml = catHtml.Provinces.map(e => e.value).join(' ');

            catHtml.Burgs.sort((a, b) => {
                if (a.name < b.name) return -1;
                if (a.name > b.name) return 1;
                return 0;
            });
            let burgsHtml = catHtml.Burgs.map(e => e.value).join(' ');

            catHtml.General.sort((a, b) => {
                if (a.name < b.name) return -1;
                if (a.name > b.name) return 1;
                return 0;
            });
            let generalHtml = catHtml.General.map(e => e.value).join(' ');

            if (catHtml.Countries.length > 0) {
                notesHtml += await renderTemplate("modules/rwk-afmg/templates/catButton.html", {
                    data: {
                        data: game.i18n.localize("azgaar.countries"),
                        filter: game.i18n.localize("azgaar.filters.countries"),
                        list: "RWKCountries"
                    }
                });
                notesHtml += countriesHtml;
                notesHtml += await renderTemplate("modules/rwk-afmg/templates/closeDiv.html", {});
            }
            if (catHtml.Provinces.length > 0) {
                notesHtml += await renderTemplate("modules/rwk-afmg/templates/catButton.html", { data: { data: game.i18n.localize("azgaar.provinces"), filter: game.i18n.localize("azgaar.filters.provinces"), list: "RWKProvinces" } });
                notesHtml += provincesHtml;
                notesHtml += await renderTemplate("modules/rwk-afmg/templates/closeDiv.html", {});
            }
            if (catHtml.Burgs.length > 0) {
                notesHtml += await renderTemplate("modules/rwk-afmg/templates/catButton.html", { data: { data: game.i18n.localize("azgaar.burgs"), filter: game.i18n.localize("azgaar.filters.burgs"), list: "RWKBurgs" } });
                notesHtml += burgsHtml;
                notesHtml += await renderTemplate("modules/rwk-afmg/templates/closeDiv.html", {});
            }
            if (catHtml.General.length > 0) {
                notesHtml += await renderTemplate("modules/rwk-afmg/templates/catButton.html", { data: { data: game.i18n.localize("azgaar.general"), filter: game.i18n.localize("azgaar.filters.general"), list: "RWKGeneral" } });
                notesHtml += generalHtml;
                notesHtml += await renderTemplate("modules/rwk-afmg/templates/closeDiv.html", {});
            }
            notesHtml += await renderTemplate("modules/rwk-afmg/templates/closeDiv.html", {});
        }
        html.find(".form-group").last().after(notesHtml);
        this.attachEventListeners(html, data.document, data.entry);
    }

    static attachEventListeners(html, noteDoc, noteEntry) {
        /* radio selector for pin fixer zoom types */
        html.find("[name='pin-default']").on('change', (event) => {
            AzgaarFM.pinDefault = `${event.target.defaultValue}PinDefault`;
        });
        /* buttons for collapsible list show/hide */
        html.find(".collapsible").on('click', (event) => {
            event.currentTarget.classList.toggle("opened");
            var content = event.currentTarget.nextElementSibling;
            if (content.style.display === "block") {
                content.style.display = "none";
            } else {
                content.style.display = "block";
            }
        });
        /* copy which note has been selected as the duplicator */
        html.find(".mapnote").on('click', (event) => {
            if (!game.keyboard_downKeys) {
                this.copyNoteData(event.currentTarget, noteDoc, noteEntry);
                ui.notifications.info(event.target.innerText + " note data copied.");
            }
            return false;
        });
        /* stop selection of note duplicator when pressing Enter */
        html.find(".mapnote").on('keydown', (event) => {
            return false;
        });
        /* process changes to the search input box */
        html.find('.filter[data-type=text] input, .filter[data-type=text] select').on('keyup change paste', event => {
            if (event.key === "Enter") return;

            const path = $(event.target).parents('.filter').data('path');
            const key = path.replace(/\./g, '');
            const value = event.target.value.toLowerCase();
            const browserCat = $(event.target).parents('.filter').data('cat');
            const scene = $(event.target).parents('.scene').data('scene');

            this.replaceList(html, browserCat, scene, value);
        });
        /* stop Enter key messing duplicator selection */
        // html.on('keydown', (event) => {
        //     if (event.key === "Enter") return;
        // });
    }

    static async replaceList(html, browserCat, sceneName, searchString) {
        //After rendering the first time or re-rendering trigger the load/reload of visible data

        let parent = html.find(`[data-scene='${sceneName}']`);
        let elements = null;
        if (browserCat === 'countries') {
            elements = parent.find("div#RWKCountries");
        } else if (browserCat === 'provinces') {
            elements = html.find("div#RWKProvinces");
        } else if (browserCat === 'burgs') {
            elements = html.find("div#RWKBurgs");
        } else if (browserCat === 'general') {
            elements = html.find("div#RWKGeneral");
        }
        if (elements?.length) {
            if (elements[0].children.length > 0) {
                await this.renderItemData(elements[0].children, searchString);
            }
        }
    }

    static async renderItemData(elements, searchString) {
        try {
            for (let element of elements) {

                if (Object.values(element.classList).includes("filter"))
                    continue;

                if (!element.innerText.toLowerCase().startsWith(searchString)) {
                    element.style.display = "none";
                } else {
                    element.style.display = "block"
                }
            }
        } catch (e) {
            if (e === STOP_SEARCH) {
                //stopping search early
            }
            else {
                throw e;
            }
        }
        return;
    }

    static copyNoteData(target, noteDoc, noteEntry) {
        const sceneOfDuplicate = game.scenes.get(target.dataset.scene);
        AzgaarFM.noteToDuplicate = sceneOfDuplicate.notes.get(target.dataset.id);
    }

    static async createNote(noteDocument, options, userId) {
        if (!AzgaarFM.noteToDuplicate) return;

        const data = AzgaarFM.noteToDuplicate.data;
        const noteType = data.flags["rwk-afmg"].journal.compendium.replace("world.", "").toLowerCase();
        let minZoom;
        let maxZoom;

        if (AzgaarFM.pinDefault === "defaultPinDefault") {
            minZoom = data.flags.pinfix.minZoomLevel;
            maxZoom = data.flags.pinfix.maxZoomLevel;
        } else {
            minZoom = AzgaarFM.pinDefaults[AzgaarFM.pinDefault][noteType].minZoom
            maxZoom = AzgaarFM.pinDefaults[AzgaarFM.pinDefault][noteType].maxZoom;
        }

        let update = {};
        update._id = noteDocument.data._id;
        update.flags = {
            pinfix: {
                minZoomLevel: minZoom,
                maxZoomLevel: maxZoom,
            },
            "rwk-afmg": {
                journal: {
                    compendium: data.flags["rwk-afmg"].journal.compendium,
                    id: data.flags["rwk-afmg"].journal.id,
                },
                permission: {
                    default: data.flags["rwk-afmg"].permission.default,
                },
            },
        };
        update.textColor = data.textColor;
        update.fontSize = data.fontSize;
        update.textAnchor = data.textAnchor;
        update.iconSize = data.iconSize;
        update.iconTint = data.iconTint;
        update.icon = data.icon;

        await noteDocument.update(update);
    }

    static updateLink(id, content) {
        const oldLink = AzgaarFM.escapeRegExp(`@Compendium[${AzgaarFM.compendiumPack}.${AzgaarFM.linkJournalId}]`);
        const regex = new RegExp(oldLink + '(\\{.*\\})', "g");
        return content.replace(regex, `@JournalEntry[${id}]$1`);
    }

    /**
    * Only called if Monks Enhanced Jounal is active.
    * All this function does for us is create a real journal if Monk opens an Azgaar one.
    */
    static async closeJournalSheet(app, html) {

        console.log("rwk-afmg | closeJournalSheet", app.document.name);
        if (!AzgaarFM.linkClicked) return;

        /* if we are here a link which is to a compendium has been clicked */

        /* find real journals with the same name as the compendium one */
        let matchedJournals = game.journal.filter(element => {
            if (element.getFlag("rwk-afmg", "journal.id") === AzgaarFM.linkJournalId)
                return element;
        });
        if (matchedJournals.length === 0) {
            /* create real journal */
            let data = {};
            data.flags = {
                "rwk-afmg": {
                    "compendiumEntry": false,
                    "permission": {
                        default: AzgaarFM.burgPerm,
                    },
                    "journal": {
                        "id": AzgaarFM.linkJournalId,
                        "compendium": AzgaarFM.compendiumPack,
                    },
                },
            };
            if (AzgaarFM.compendiumPack.includes("Burgs"))
                mergeObject(data.flags, {
                    "monks-enhanced-journal": {
                        "type": 'place'
                    },
                });
            let compendium = game.packs.get(AzgaarFM.compendiumPack);
            const realDoc = await game.journal.importFromCompendium(compendium, AzgaarFM.linkJournalId, data);
            /* link to new journal */
            let content = AzgaarFM.updateLink(realDoc.id, app.document.data.content);

            if (content) {
                /* update this journal */
                await app.document.update({ content: content });
            }
            /* update map note */
            const notesArray = canvas.notes.placeables.filter(note => {
                const cJournal = note.document.getFlag("rwk-afmg", "journal");
                if (note.document.data.text === realDoc.name)
                    if (cJournal.id === AzgaarFM.linkJournalId)
                        return note;
            });
            if (notesArray.length === 1)
                notesArray[0].document.update({ entry: realDoc, entryId: realDoc.id });

        } else if (matchedJournals.length === 1) { // needs more work
            const realDoc = matchedJournals[0];
            /* link to new journal */
            let content = this.updateLink(realDoc.id, app.document.data.content);
            if (content) {
                /* update this journals link */
                await app.document.update({ content: content });
            }
        } else {
            console.error("rwk-afmg | closeJournalSheet - too many journals matched to this compendium journal");
            for (journal in matchedJournals) {
                console.error("rwk-afmg | closeJournalSheet - journal id :", journal.id);
            }
            console.error("rwk-afmg | closeJournalSheet. You can show journal ids using Developer Mode module @ https://github.com/League-of-Foundry-Developers/foundryvtt-devMode");
        }
        AzgaarFM.linkClicked = false;
        AzgaarFM.linkJournalId = undefined;
        AzgaarFM.compendiumPack = undefined;
    }

    static async openJournalEntry(journalEntry, options, userId) {

        /* get the last note that was hovered which will have been the clicked one */
        const note = canvas.notes._hover;
        if (note) {
            /* if journal has no sceneNote return */
            if (!journalEntry.sceneNote) return;
            /* if note is not "Azgaar" just return */
            if (note.entry.name !== "Azgaar FMG") return;
            /* if the journalEntry is not "Azgaar" return */
            if (journalEntry.name !== "Azgaar FMG") return;
            /* Need to create "real" entry from compendium */
            const noteEntryData = note.document.getFlag("rwk-afmg", "journal");
            const cPerm = note.document.getFlag("rwk-afmg", "permission");
            /* All Azgaar MapNotes are the default "Azgaar FMG" so we need the "real" JournalEntry. Always let the GM through!*/
            if (noteEntryData && (cPerm?.default >= 2 || game.user.isGM)) {
                let data = {};
                data.flags = {
                    "rwk-afmg": {
                        "compendiumEntry": false,
                        "permission": cPerm,
                        "journal": {
                            "id": noteEntryData.id,
                            "compendium": noteEntryData.compendium,
                        },
                    },
                };
                if (noteEntryData.compendium.includes("Burgs"))
                    mergeObject(data.flags, {
                        "monks-enhanced-journal": {
                            "type": 'place'
                        },
                    });
                const compendium = game.packs.get(noteEntryData.compendium);
                const realDoc = await game.journal.importFromCompendium(compendium, noteEntryData.id, data);
                note.document.update({ entry: realDoc, entryId: realDoc.id });
                AzgaarFM.render(realDoc);
            }
        }
        return true;
    }

    static checkLinks(journalEntry) {

        const linkText = `data-id="(\\w+\\.\\w+\\.\\w+)\\{.*\\}".*@JournalEntry\\[(\\w+)\]\\{.*\\}`
        const linkText2 = `data-id="(\\w+\\.\\w+\\.\\w+)".*@JournalEntry\\[(\\w+)\]\\{.*\\}`
        const regex = new RegExp(linkText2, "g");
        const journalLinks = [...journalEntry.data.content.matchAll(regex)];
        let content;

        for (const link of journalLinks) {
            const journal = game.journal.get(link[2]);
            if (journal === undefined) {
                /* need to find original compendium link to this journal */
                const compendiumId = link[1];
                const journalId = link[2];
                content = journalEntry.data.content;
                /* link to new journal */
                const oldLink = `@JournalEntry[${journalId}]`;
                const newLink = `@Compendium[${compendiumId}]`;
                content = content.replace(oldLink, newLink);
            }
        }
        return content;
    }

    static async renderJournalSheet(app, html, data) {

        /* check journal for undefined links */
        if (hasProperty(data.data.flags, 'rwk-afmg') || hasProperty(data.data.flags, 'EEEG-Importer')) {
            let content = AzgaarFM.checkLinks(data);
            if (content) {
                /* update this journal */
                await app.document.update({ content: content });
            }
        }
    }

    static escapeRegExp(stringToGoIntoTheRegex) {
        return stringToGoIntoTheRegex.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    }
}

Hooks.once("libWrapper.Ready", () => {

    /* register the link click listener of the text editor */
    libWrapper.register("rwk-afmg", "TextEditor.prototype.constructor._onClickContentLink", AzgaarFM.onLeftClickJournalLink, "MIXED");

    /* this is so libWrapper doesn't complain about Monk's Enhanced Journal */
    if (!game.modules.get("monks-enhanced-journal")?.active) {
        libWrapper.register("rwk-afmg", "Note.prototype._onClickLeft2", AzgaarFM.onClickLeft2MapNote, "MIXED");
    }
});

Hooks.on("renderSidebarTab", async (app, html) => {
    if (app?.options?.id === "scenes" && game.user.isGM) {
        let button = $("<div class='header-actions action-buttons flexrow'><button class='rwk-import'><i class='fas fa-scroll'></i> Import AFMG Map</button></div>");
        button.on('click', () => {
            new LoadAzgaarMap().render(true);
        });
        $(html).find(".directory-header").append(button);
    }
});

Hooks.once("init", async (...args) => AzgaarFM.init(...args));
Hooks.on("ready", async (...args) => AzgaarFM.ready(...args));
Hooks.on("openJournalEntry", async (...args) => AzgaarFM.openJournalEntry(...args));
Hooks.on("closeJournalSheet", async (...args) => AzgaarFM.closeJournalSheet(...args));
Hooks.on("renderJournalSheet", async (...args) => AzgaarFM.renderJournalSheet(...args));
Hooks.on("renderNoteConfig", (...args) => AzgaarFM.renderNoteConfig(...args));
Hooks.on("createNote", (...args) => AzgaarFM.createNote(...args));