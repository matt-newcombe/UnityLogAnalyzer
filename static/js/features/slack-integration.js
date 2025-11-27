/**
 * Slack Integration
 * Handles copying formatted data to clipboard for Slack messages
 */

/**
 * Copy formatted headlines to clipboard for Slack
 * Fetches data and formats it in Slack markdown
 */
async function copySlackHeadlines() {
    const btn = document.getElementById('slack-copy-btn');
    const originalText = btn.textContent;
    
    try {
        btn.textContent = 'Loading...';
        btn.disabled = true;
        
        // Fetch all required data
        const [summary, assets, timeline] = await Promise.all([
            window.apiClient.getSummary(),
            window.apiClient.getAssets(),
            window.apiClient.getTimeline()
        ]);
        
        // Build Slack-formatted text
        let slackText = '*Unity Project Load Analysis*\n\n';
        
        // Total load time
        const totalTime = summary.project_load_time_seconds || 0;
        slackText += `*Total Load Time:* ${formatTime(totalTime)}\n\n`;
        
        // Top 3 import time categories
        const topCategories = (summary.by_category || []).slice(0, 3);
        if (topCategories.length > 0) {
            slackText += '*Top 3 Import Time Categories:*\n';
            topCategories.forEach((cat, idx) => {
                slackText += `${idx + 1}. *${cat.asset_category}*: ${formatTime((cat.total_time || 0) / 1000)}\n`;
            });
            slackText += '\n';
        }
        
        // Top 3 worst files
        const topWorst = assets
            .sort((a, b) => b.import_time_ms - a.import_time_ms)
            .slice(0, 3);
        if (topWorst.length > 0) {
            slackText += '*Top 3 Slowest Assets:*\n';
            topWorst.forEach((asset, idx) => {
                const timeSeconds = asset.import_time_ms / 1000;
                const assetName = asset.asset_name || asset.asset_path.split('/').pop() || 'Unknown';
                slackText += `${idx + 1}. *${assetName}* (${asset.asset_type || 'N/A'}): ${formatTime(timeSeconds)}\n`;
            });
            slackText += '\n';
        }
        
        // Script compilation time
        const scriptCompTime = timeline.summary?.script_compilation_time_ms || 0;
        if (scriptCompTime > 0) {
            slackText += `*Script Compilation Time:* ${formatTime(scriptCompTime / 1000)}\n`;
        } else {
            slackText += `*Script Compilation Time:* N/A\n`;
        }
        
        // Copy to clipboard
        await navigator.clipboard.writeText(slackText);
        
        // Show success feedback
        btn.textContent = '✓ Copied!';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 2000);
    } catch (error) {
        console.error('Failed to copy Slack headlines:', error);
        btn.textContent = 'Error';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 2000);
    }
}

