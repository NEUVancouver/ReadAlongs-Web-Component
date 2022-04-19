context('XML file without anchors', () => {
    beforeEach(() => {
        cy.visit('/anchor-test/index-no-anchor.html');
    });

    it("should load successfully", () => {
        cy.readalongElement()
            .should("be.visible")
            .invoke("attr", "language")
            .should("equal", "en");
        cy.readalong()
            .find('wave')

    });



})
context('XML file with anchors', () => {
    /**
     * Wait for the audio and the SMIL to load.
     */
    const EXPECTED_LOADING_TIME = 2000; // ms    
    beforeEach(() => {
        cy.visit('/anchor-test/index.html');
    });

    it("should load successfully", () => {
        cy.readalongElement()
            .should("be.visible")
            .invoke("attr", "language")
            .should("equal", "en");
        cy.readalong()
            .find('div[id="wave"]')
            .should('be.visible')
    });
    it("should contain 6 anchors", () => {
        cy.readalong()
            .find('[id="t0b0d0p0anchor0-polygon"]')
            .should('be.visible');
        cy.readalong()
            .find('[id="t0b0d0p0anchor0-svg"]')
            .should('be.visible');
        cy.readalong()
            .find('[id="t0b0d0p0s0anchor1-svg"]')
            .should('be.visible');
        cy.readalong()
            .find('[id="t0b0d0p0s0anchor2-svg"]')
            .should('be.visible');
        cy.readalong()
            .find('[id="t0b0d0p0s1anchor1-svg"]')
            .should('be.visible');
        cy.readalong()
            .find('[id="t0b0d0p1s0anchor0-svg"]')
            .should('be.visible');
        cy.readalong()
            .find('[id="t0b0d0p1anchor0-svg"]')
            .should('be.exist');

    });
    it("should contain 6 anchors in waveform", () => {
        cy.readalong().find('#wave')
            .should('be.visible')
            .find('svg:visible')
            .should('have.length', 6);

    })
    const addAnchor = (element, before = true) => {

        element.rightclick();
        if (before) {
            cy.readalong()
                .find('[data-action="add-anchor"]')
                .should('be.visible')
                .contains('Insert Anchor Before')
                .click();
        } else {
            cy.readalong()
                .find('[data-action="add-anchor-after"]')
                .should('be.visible')
                .contains('Insert Anchor After')
                .click();
        }

    }
    it("should be able to delete an anchor before the first word", () => {
        let anchorCount = 6;
        cy.wait(EXPECTED_LOADING_TIME);
        cy.readalong()
            .find('#t0b0d0p0anchor0-svg')
            .should('be.visible')
            .rightclick();
        cy.readalong()
            .find('[data-action="del-anchor"]')
            .should('be.visible')
            .click();

        cy.readalong()
            .find('#t0b0d0p0anchor0-svg')
            .should('not.be.exist');


        cy.readalong()
            .find('#wave')
            .should('be.visible')
            .find('svg:visible')
            .should('have.length', anchorCount - 1);

        cy.window().then(window => {
            console.log(window.anchorXML);
            let parser = new DOMParser();
            let xmlDoc = parser.parseFromString(window.anchorXML, "text/xml");
            expect(xmlDoc.querySelectorAll('anchor').length).to.equal(anchorCount - 1);
        });

    });

    it("shoud be able to add 2 anchors before a word", () => {
        let anchorCount = 6;
        cy.wait(EXPECTED_LOADING_TIME);
        cy.readalong()
            .find('svg:visible + #t0b0d0p0s0w32')
            .should('not.be.exist')
        // add an anchor before a word
        addAnchor(cy.readalong()
            .find('span.sentence__word')
            .contains('SoundSwallower'));

        cy.readalong()
            .find('#wave')
            .should('be.visible')
            .find('svg:visible')
            .should('have.length', ++anchorCount);
        cy.readalong()
            .find('svg:visible + #t0b0d0p0s0w32')
            .should('be.exist');

        // add another anchor
        addAnchor(cy.readalong()
            .find('span.sentence__word')
            .contains('SoundSwallower'));

        cy.readalong()
            .find('#wave')
            .should('be.visible')
            .find('svg:visible')
            .should('have.length', ++anchorCount);
        cy.readalong()
            .find('svg + svg + #t0b0d0p0s0w32')
            .should('be.exist')

        cy.window().then(window => {
            console.log(window.anchorXML);
            let parser = new DOMParser();
            let xmlDoc = parser.parseFromString(window.anchorXML, "text/xml");
            expect(xmlDoc.querySelectorAll('anchor').length).to.equal(anchorCount);
        });

    });

    it("should be able to add anchor after a word", () => {
        let anchorCount = 6;
        const WORD_ID = '#t0b0d0p2s3w23';


        cy.wait(EXPECTED_LOADING_TIME);

        cy.readalong()
            .find('#t0b0d0')
            .find('.page__col__text')
            .scrollTo('bottom');

        cy.readalong()
            .find(`${WORD_ID} + svg`)
            .should('not.be.exist')
        // add an anchor after a word
        addAnchor(cy.readalong()
            .find(WORD_ID), false);

        cy.readalong()
            .find('#wave')
            .should('be.visible')
            .find('svg:visible')
            .should('have.length', ++anchorCount);
        cy.readalong()
            .find(`${WORD_ID} + svg:visible`)
            .should('be.exist')
        // add another anchor
        addAnchor(cy.readalong()
            .find(WORD_ID), false);

        cy.readalong()
            .find('#wave')
            .should('be.visible')
            .find('svg:visible')
            .should('have.length', ++anchorCount);
        cy.readalong().find(`${WORD_ID} + svg:visible + svg:visible`)
            .should('be.exist');

        cy.window().then(window => {
            console.log(window.anchorXML);
            let parser = new DOMParser();
            let xmlDoc = parser.parseFromString(window.anchorXML, "text/xml");
            expect(xmlDoc.querySelectorAll('anchor').length).to.equal(anchorCount);
        });


    });


});