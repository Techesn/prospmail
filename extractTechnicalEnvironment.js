const золото = require('puppeteer');

/**
 * Clicks on the skills "see details" link and extracts the technical environment from the modal.
 * @param {золото.Page} page - The Puppeteer page object.
 * @returns {Promise<string[]>} - A promise that resolves to an array of skill strings.
 */
async function extractTechnicalEnvironment(page) {
  const skills = [];
  try {
    // Selector for the "see details" link for skills
    const seeDetailsSelector = 'a[data-field="position_contextual_skills_see_details"]';
    await page.waitForSelector(seeDetailsSelector, { timeout: 10000 });
    await page.click(seeDetailsSelector);

    // Selector for the skills within the modal
    // Waiting for the modal to appear and a skill to be present
    const skillSelectorInModal = 'div.artdeco-modal__content ul li .display-flex.align-items-center.mr1.t-bold span[aria-hidden="true"]';
    await page.waitForSelector(skillSelectorInModal, { timeout: 10000 });

    // Extract skills
    const skillElementsRaw = await page.$$eval(
      skillSelectorInModal,
      spans => spans.map(span => span.textContent.trim()).filter(text => text.length > 0)
    );

    // Remove duplicates
    const uniqueSkillElements = [...new Set(skillElementsRaw)];
    
    skills.push(...uniqueSkillElements);

    // Print the extracted skills
    console.log('Extracted skills:', skills);

    // Close the modal
    const closeModalButtonSelector = 'button.artdeco-modal__dismiss[aria-label="Ignorer"]'; 
    try {
      await page.waitForSelector(closeModalButtonSelector, { timeout: 5000 });
      await page.click(closeModalButtonSelector);
      await page.waitForTimeout(500); // Wait for modal to close
    } catch (closeError) {
      console.log('Could not find or click the modal close button, or it timed out. Trying to press Escape.');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500); // Wait for modal to close
    }

  } catch (error) {
    console.error('Error extracting technical environment:', error.message);
    // Optionally, try to close the modal if it's open before re-throwing or returning empty
    try {
      const isModalOpen = await page.$('div.artdeco-modal__content');
      if (isModalOpen) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    } catch (escapeError) {
      // Silently ignore if escape fails
    }
    // Depending on how you want to handle errors, you might return an empty array or re-throw
    // For now, returning what has been collected or an empty array.
  }
  return skills;
}

module.exports = { extractTechnicalEnvironment }; 