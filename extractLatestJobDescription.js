const { extractTechnicalEnvironment } = require('./extractTechnicalEnvironment');

async function extractLatestJobDescription(page) {
    console.log('Starting job description extraction...');
    let jobData = { description: null, technicalSkills: [] };

    // 1. Find the "Experience" section
    const experienceSectionHandle = await page.evaluateHandle(() => {
        const headers = Array.from(document.querySelectorAll('h2'));
        let experienceHeader = null;
        for (const h of headers) {
            const span = h.querySelector('span[aria-hidden="true"]');
            if (span && (span.textContent.trim().toLowerCase() === 'expérience' || span.textContent.trim().toLowerCase() === 'experience')) {
                experienceHeader = h;
                break;
            }
        }

        if (!experienceHeader) {
            const allElementsWithText = Array.from(document.querySelectorAll('*'));
            const potentialHeader = allElementsWithText.find(el => 
                (el.tagName === 'H2' || el.getAttribute('role') === 'heading' && el.getAttribute('aria-level') === '2') &&
                (el.textContent.trim().toLowerCase().includes('experience') || el.textContent.trim().toLowerCase().includes('expérience')) &&
                el.offsetWidth > 0 && el.offsetHeight > 0
            );
            if (potentialHeader) experienceHeader = potentialHeader;
        }
        
        if (!experienceHeader) return null;

        let parentSection = experienceHeader.closest('section');
        if (!parentSection) {
            parentSection = experienceHeader.closest('div[id^="experience"], div[class*="experience"], section[id^="experience"], section[class*="experience"]');
        }
        if (!parentSection) {
             parentSection = experienceHeader.parentElement?.parentElement;
        }
        return parentSection;
    });

    if (!experienceSectionHandle || !experienceSectionHandle.asElement()) {
        console.error('Experience section not found.');
        if(experienceSectionHandle) await experienceSectionHandle.dispose();
        return jobData;
    }
    console.log('Experience section found.');

    const latestExperienceItemHandle = await experienceSectionHandle.evaluateHandle(sectionEl => {
        // Step 1: Find all potential top-level experience wrappers/blocks
        // These are typically direct children of the section, either experience divs or list items wrapping experiences.
        let topLevelExperienceWrappers = Array.from(sectionEl.querySelectorAll(
            ':scope > div[data-view-name="profile-component-entity"], ' +
            ':scope > ul > li, ' +
            ':scope > div > ul > li'
        ));

        if (topLevelExperienceWrappers.length === 0) {
            // Fallback: if no direct entities or list items under common structures, try any direct div children
            topLevelExperienceWrappers = Array.from(sectionEl.querySelectorAll(':scope > div'));
            if (topLevelExperienceWrappers.length === 0) {
                // console.error('No potential top-level experience wrappers found in section.');
                return null;
            }
        }

        // Step 2: The first element in this list is the wrapper for the latest experience.
        const latestExperienceWrapper = topLevelExperienceWrappers[0];
        let latestExperienceEntity = null;

        // Step 3: Extract the actual 'profile-component-entity' div from this wrapper.
        if (latestExperienceWrapper.matches('div[data-view-name="profile-component-entity"]')) {
            latestExperienceEntity = latestExperienceWrapper;
        } else {
            // It's likely an <li> or a generic <div> wrapper. Look for the entity inside.
            const entityInside = latestExperienceWrapper.querySelector('div[data-view-name="profile-component-entity"]');
            if (entityInside && latestExperienceWrapper.contains(entityInside)) {
                latestExperienceEntity = entityInside;
            }
        }

        if (!latestExperienceEntity) {
            // console.error('Failed to identify the specific div[data-view-name="profile-component-entity"] for the latest experience.');
            return null;
        }

        // Step 4: If this entity is a company block with multiple roles, drill down to the first role.
        let finalEntityToParse = latestExperienceEntity;
        
        // Query for profile-component-entity divs *directly inside* the pvs-entity__sub-components of latestExperienceEntity,
        // or just any direct children if pvs-entity__sub-components doesn't exist or doesn't contain them.
        // This targets specific roles listed under a company entry.
        const subGrid = latestExperienceEntity.querySelector('.pvs-entity__sub-components .pvs-list, .pvs-entity__sub-components ul, .pvs-entity__sub-components > div > ul');
        let subRoles = [];

        if (subGrid) {
             subRoles = Array.from(subGrid.querySelectorAll(':scope > li div[data-view-name="profile-component-entity"]'));
        }
        
        // Fallback or alternative: find any nested profile-component-entity not identical to the parent.
        // This might be too broad if not careful, ensure they are true descendants.
        if (subRoles.length === 0) {
            const allNestedEntities = Array.from(latestExperienceEntity.querySelectorAll('div[data-view-name="profile-component-entity"]'));
            subRoles = allNestedEntities.filter(el => el !== latestExperienceEntity && latestExperienceEntity.contains(el));
        }
        
        if (subRoles.length > 0) {
            // This means latestExperienceEntity was a company/group (like Payplug company),
            // and subRoles contains the individual positions (like VP Eng, Eng Director).
            // We take the first sub-role as the specific "latest experience" in this context.
            finalEntityToParse = subRoles[0];
            // console.log(`Company block identified. Selected first sub-role: ${finalEntityToParse.textContent.substring(0,70).trim()}`);
        } else {
            // console.log(`Single role entity identified: ${finalEntityToParse.textContent.substring(0,70).trim()}`);
        }

        return finalEntityToParse;
    });

    if (!latestExperienceItemHandle || !latestExperienceItemHandle.asElement()) {
        console.error('Latest experience item not found within the experience section.');
        if(latestExperienceItemHandle) await latestExperienceItemHandle.dispose();
        await experienceSectionHandle.dispose();
        return jobData;
    }
    console.log('Latest experience item identified.');

    const description = await latestExperienceItemHandle.evaluate(itemEl => {
        let rawHtml = null;
        
        // Stage 1: Try to find description within a specific sub-components container
        const subComponentsDiv = itemEl.querySelector('.pvs-entity__sub-components');

        if (subComponentsDiv) {
            // console.log('Found pvs-entity__sub-components, searching for description text within it.');
            const descSelectorsInSub = [
                { selector: 'div.inline-show-more-text span.visually-hidden' }, // type: 'direct' implied
                { selector: 'div.inline-show-more-text span[aria-hidden="true"]:not(button span)' } // type: 'direct' implied
            ];

            for (const { selector } of descSelectorsInSub) {
                const elements = Array.from(subComponentsDiv.querySelectorAll(selector));
                if (elements.length > 0) {
                    const targetElement = elements[0];
                    if (targetElement && !targetElement.closest('button, a, h1, h2, h3, h4, h5, h6, [role="button"], [data-test-id="position-entity-date-range"]')) {
                        rawHtml = targetElement.innerHTML;
                        // console.log(`Description found in sub-component with selector: ${selector}`);
                        break; 
                    }
                }
            }
        } else {
            // console.log('No pvs-entity__sub-components div found in this experience item.');
        }

        // Stage 2: If no description found yet, fall back to original broader selectors on itemEl
        if (!rawHtml) {
            // console.log('Attempting fallback to general selectors on the entire experience item.');
            const originalDescriptionSelectors = [
                { selector: 'div.inline-show-more-text span.visually-hidden', type: 'direct' },
                { selector: 'div.inline-show-more-text span[aria-hidden="true"]:not(button span)', type: 'direct' },
                { selector: 'div[tabindex="-1"][dir="ltr"] span.visually-hidden', type: 'direct' },
                { selector: 'div[tabindex="-1"][dir="ltr"] span[aria-hidden="true"]:not(button span)', type: 'direct' },
                { selector: 'span.visually-hidden', type: 'general' },
                { selector: 'span[aria-hidden="true"]:not(button span)', type: 'general' }
            ];

            for (const { selector, type } of originalDescriptionSelectors) {
                const elements = Array.from(itemEl.querySelectorAll(selector)); // Query on itemEl
                let targetElement = null;

                if (elements.length > 0) {
                    if (type === 'direct') {
                        targetElement = elements[0];
                        if (targetElement && targetElement.closest('button, a, h1, h2, h3, h4, h5, h6, [role="button"], [data-test-id="position-entity-date-range"]')) {
                            targetElement = null; 
                        }
                    } else if (type === 'general') {
                        targetElement = elements.find(span => {
                            if (span.closest('button, a, h1, h2, h3, h4, h5, h6, [role="button"], [data-test-id="position-entity-date-range"]')) return false;
                            const textContent = span.textContent || "";
                            const innerHTMLContent = span.innerHTML || "";
                            return (textContent.trim().length > 30 || innerHTMLContent.includes('<br'));
                        });
                    }
                }
                
                if (targetElement) {
                    rawHtml = targetElement.innerHTML;
                    // console.log(`Description found with fallback selector on itemEl: ${selector}`);
                    break;
                }
            }
        }

        if (rawHtml) {
            // console.log('Final rawHtml before cleaning:', rawHtml.substring(0, 100));
            return rawHtml
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/&nbsp;/g, ' ')
                .replace(/<[^>]+>/g, '')
                .replace(/\n /g, '\n')
                .trim();
        }
        // console.log('No description text found with any method for this item.');
        return null;
    });

    await latestExperienceItemHandle.dispose();
    await experienceSectionHandle.dispose();

    if (description) {
        console.log('Job description extracted successfully.');
        jobData.description = description;
    } else {
        console.log('Job description not found for the latest experience.');
    }

    // Extract technical environment (now runs regardless of description)
    try {
        console.log('Attempting to extract technical environment (runs independently of description)...');
        const skills = await extractTechnicalEnvironment(page);
        jobData.technicalSkills = skills;
        console.log('Technical environment extraction attempt finished.');
    } catch (techSkillsError) {
        console.error('Could not extract technical environment:', techSkillsError.message);
        // Keep jobData.technicalSkills as [] (as initialized)
    }

    return jobData; // Return an object containing both description and skills
}

module.exports = { extractLatestJobDescription }; 