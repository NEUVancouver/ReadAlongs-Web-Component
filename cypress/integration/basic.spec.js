context("The Readalong Component (test xml and m4a file)", () => {
  /**
   * Wait for the audio and the SMIL to load.
   */
  const EXPECTED_LOADING_TIME = 2000; // ms

  const FOR_PAGE_TURN_ANIMATION = 500; // ms
  const FOR_ERIC_TO_TALK_A_BIT = 3000; // ms

  beforeEach(() => {
    cy.visit("/ej-fra/");
  });
  //new test
  it("should load successfully", () => {
    cy.readalongElement()
      .should("be.visible")
      .invoke("attr", "language")
      .should("equal", "fra");
  });

  it("should return a time specs when invoke getTime", () => {
    cy.window()
      .its('readAlong')
      .invoke('getTime', 't0b0d1p0s1w4')
      .should('eq', 15.36);
  });

  it("should highlight the word at the given time", () => {
    cy.wait(EXPECTED_LOADING_TIME);
    cy.window()
      .its('readAlong')
      .then(readAlong => {
        console.log(readAlong);
        console.log(readAlong.goToTime(5));
        cy.readalong().within(() => {
          cy.get("[id = 't0b0d0p0s2w9']").should('have.class', 'reading');  // should update the class attributes when execute goToTime
        })
      })
  });

  it("should play the entire ReadAlong", () => {
    cy.wait(EXPECTED_LOADING_TIME);

    cy.readalong().within(() => {
      cy.get("[data-cy=play-button]").click();
      cy.wait(FOR_ERIC_TO_TALK_A_BIT);
      cy.get("[data-cy=stop-button]").click();
    });
  });

  it("should play a single word when clicked", () => {
    cy.wait(EXPECTED_LOADING_TIME);

    cy.readalong().contains("technologies").click();
  });

  describe("the progress bar", () => {
    it("should skip ahead when clicked", () => {
      cy.wait(EXPECTED_LOADING_TIME);

      cy.readalong().within(() => {
        cy.get("[data-cy=play-button]").click();
        cy.get("[data-cy=page-count__current]")
          .filter("*:visible")
          .invoke("text")
          .should("eq", "1");

        cy.get("[data-cy=progress-bar]")
          .as("progress-bar")
          .then((el) => {
            // click 3/4 of the way in the readalong (should be second page)
            cy.get("@progress-bar").click(el.width() * 0.85, el.height() * 0.5);  // change 0.75 to 0.85 to avoid occasional unpaging
          });
        cy.get("[data-cy=stop-button]").click();
        cy.wait(FOR_PAGE_TURN_ANIMATION);

        cy.get("[data-cy=page-count__current]")
          .filter("*:visible")
          .invoke("text")
          .should("eq", "2");
      });
    });
  });
});

context("The Readalong Component (test xml and mp3 file)", () => {
  /**
   * Wait for the audio and the SMIL to load.
   */
  const EXPECTED_LOADING_TIME = 2000; // ms

  const FOR_ONE_TO_TALK_A_BIT = 3000; // ms

  beforeEach(() => {
    cy.visit("/udhr-gla/");
  });
  //new test
  it("should load successfully", () => {
    cy.readalongElement()
      .should("be.visible")
      .invoke("attr", "language")
      .should("equal", "gla");
  });

  it("should get the time of selected word", function () {
    cy.window()
      .its("readAlong")
      .then((readAlong) => {
        expect(readAlong.getTime("t0b0d0p0s0w6")).to.equal(1.77);
      });
  });

  it("should highlight the word at the given time", function () {
    cy.wait(EXPECTED_LOADING_TIME);
    cy.window()
      .its("readAlong")
      .then((readAlong) => {
        readAlong.goToTime(3);
      });
    cy.readalong().within(() => {
      cy.get("[id='t0b0d0p0s0w9']").should("have.class", "reading");  // should update the class attributes when execute goToTime
    });
  });

  it("should play the entire ReadAlong", () => {
    cy.wait(EXPECTED_LOADING_TIME);

    cy.readalong().within(() => {
      cy.get("[data-cy=play-button]").click();
      cy.wait(FOR_ONE_TO_TALK_A_BIT);
      cy.get("[data-cy=stop-button]").click();
    });
  });

  it("should play a single word when clicked", () => {
    cy.wait(EXPECTED_LOADING_TIME);

    cy.readalong().contains("reusanta").click();
  });
});

context("The Readalong Component (test xml and wav file)", () => {
  /**
   * Wait for the audio and the SMIL to load.
   */
  const EXPECTED_LOADING_TIME = 2000; // ms

  const FOR_AIDAN_TO_TALK_A_BIT = 3000; // ms

  beforeEach(() => {
    cy.visit("/ap_dan/");
  });
  //new test
  it("should load successfully", () => {
    cy.readalongElement()
      .should("be.visible")
      .invoke("attr", "language")
      .should("equal", "en");
  });

  it("should get the time of selected word", function () {
    cy.window()
      .its("readAlong")
      .then((readAlong) => {
        expect(readAlong.getTime("t0b0d0p0s1w1")).to.equal(2.27);
      });
  });
  
  it("should highlight the word at the given time", function () {
    cy.wait(EXPECTED_LOADING_TIME);
    cy.window()
      .its("readAlong")
      .then((readAlong) => {
        readAlong.goToTime(5);
      });
    cy.readalong().within(() => {
      cy.get("[id='t0b0d0p0s1w7']").should("have.class", "reading");
    });
  });

  it("should play the entire ReadAlong", () => {
    cy.wait(EXPECTED_LOADING_TIME);

    cy.readalong().within(() => {
      cy.get("[data-cy=play-button]").click();
      cy.wait(FOR_AIDAN_TO_TALK_A_BIT);
      cy.get("[data-cy=stop-button]").click();
    });
  });

  it("should play a single word when clicked", () => {
    cy.wait(EXPECTED_LOADING_TIME);

    cy.readalong().contains("urbefolkeningerne").click();
  });
});
