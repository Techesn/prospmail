async function getRedirectedUrl(originalUrl, page, liAtCookieValue) {
    if (!originalUrl || !originalUrl.startsWith('http')) {
        console.warn(`Skipping invalid URL: ${originalUrl}`);
        return { url: null, error: null };
    }
    try {
        await page.setCookie({
            name: 'li_at',
            value: liAtCookieValue,
            domain: '.linkedin.com',
            path: '/',
            secure: true,
            httpOnly: true,
        });
        console.log(`Navigating to: ${originalUrl} using existing page...`);
        const response = await page.goto(originalUrl, { timeout: 60000 });
        console.log(`Waiting 2000ms for page to load after navigation to ${originalUrl}...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        const finalUrl = page.url();
        console.log(`Redirected to: ${finalUrl}`);
        return { url: finalUrl, error: null };
    } catch (error) {
        console.error(`Error navigating to ${originalUrl}: ${error.message}`);
        return { url: null, error: error };
    }
}

module.exports = { getRedirectedUrl }; 