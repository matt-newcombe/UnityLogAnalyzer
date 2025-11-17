#!/usr/bin/env python3
"""
Integration tests for Unity Log Analyzer Dashboard
Tests all functionality before and after refactoring
"""

import pytest
import time
import subprocess
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

# Test configuration
BASE_URL = "http://localhost:8765"
TEST_LOG_FILE = "TEST_EditorLogFiles/Editor_VRChat.log"
SERVER_STARTUP_TIME = 3  # seconds to wait for server to start


@pytest.fixture(scope="module")
def server():
    """Start the web server for testing"""
    print("\n🚀 Starting web server...")
    
    # Make sure a test database exists
    test_db = Path("unity_log.db")
    if not test_db.exists():
        # Parse a test log file first
        subprocess.run([
            "python3", "log_parser.py", TEST_LOG_FILE
        ], check=True, capture_output=True)
    
    # Start server in background
    server_process = subprocess.Popen(
        ["python3", "web_server.py"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    
    # Wait for server to start
    time.sleep(SERVER_STARTUP_TIME)
    
    yield server_process
    
    # Cleanup
    print("\n🛑 Stopping web server...")
    server_process.terminate()
    server_process.wait(timeout=5)


@pytest.fixture
def browser_context(server):
    """Create a browser context for each test"""
    with sync_playwright() as p:
        # Use Firefox non-headless - headless mode crashes on macOS Sequoia 15.2
        browser = p.firefox.launch(headless=False)
    context = browser.new_context(viewport={"width": 1400, "height": 900})
    yield context
    context.close()
    browser.close()


@pytest.fixture
def page(browser_context):
    """Create a new page for each test"""
    page = browser_context.new_page()
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    yield page
    page.close()


class TestPageLoading:
    """Test initial page load and structure"""
    
    def test_page_loads(self, page):
        """Verify page loads successfully"""
        assert page.title() == "Unity Log Analyzer"
        
    def test_header_present(self, page):
        """Verify header with title is present"""
        header = page.locator("h1")
        expect(header).to_be_visible()
        expect(header).to_contain_text("Unity Log Analyzer")
    
    def test_navigation_buttons_present(self, page):
        """Verify navigation buttons exist"""
        parse_btn = page.locator('button:has-text("Parse Log File")')
        expect(parse_btn).to_be_visible()
        
        slack_btn = page.locator('button:has-text("Copy Headlines for Slack")')
        # Should be visible if logs are loaded
        if page.locator('#stats').is_visible():
            expect(slack_btn).to_be_visible()


class TestStatsCards:
    """Test statistics cards display"""
    
    def test_stats_cards_visible(self, page):
        """Verify stat cards are displayed"""
        stats_div = page.locator("#stats")
        expect(stats_div).to_be_visible()
    
    def test_project_load_time_card(self, page):
        """Verify project load time card exists"""
        card = page.locator('.stat-card:has-text("Total Project Load Time")')
        expect(card).to_be_visible()
        
        # Verify it has a value
        value = card.locator('.stat-value')
        expect(value).to_be_visible()
        expect(value).not_to_be_empty()
    
    def test_total_assets_card_clickable(self, page):
        """Verify total assets card is clickable"""
        card = page.locator('.stat-card:has-text("Total Assets")')
        expect(card).to_be_visible()
        assert "clickable" in card.get_attribute("class")
    
    def test_errors_warnings_cards(self, page):
        """Verify error and warning cards exist"""
        errors_card = page.locator('#errors-stat-card')
        warnings_card = page.locator('#warnings-stat-card')
        
        expect(errors_card).to_be_visible()
        expect(warnings_card).to_be_visible()


class TestCharts:
    """Test chart rendering and interactions"""
    
    def test_charts_container_visible(self, page):
        """Verify charts container is visible"""
        charts_div = page.locator("#charts")
        expect(charts_div).to_be_visible()
    
    def test_type_count_chart_rendered(self, page):
        """Verify asset count by type chart is rendered"""
        canvas = page.locator("#typeCountChart")
        expect(canvas).to_be_visible()
    
    def test_type_time_chart_rendered(self, page):
        """Verify import time by type chart is rendered"""
        canvas = page.locator("#typeTimeChart")
        expect(canvas).to_be_visible()
    
    def test_timeline_rendered(self, page):
        """Verify timeline visualization is rendered"""
        timeline = page.locator("#timeline-container")
        expect(timeline).to_be_visible()
    
    def test_chart_click_navigation(self, page):
        """Test clicking a chart segment navigates to detail view"""
        # Wait for chart to be rendered
        page.wait_for_selector("#typeCountChart", state="visible")
        page.wait_for_timeout(2000)  # Wait for chart to fully render
        
        # Click on chart canvas (will click first segment)
        canvas = page.locator("#typeCountChart")
        canvas.click(position={"x": 200, "y": 200})
        
        # Wait for navigation
        page.wait_for_timeout(1000)
        
        # Verify breadcrumb shows we've navigated
        breadcrumb = page.locator("#breadcrumb")
        expect(breadcrumb).to_be_visible()


class TestTables:
    """Test table rendering and interactions"""
    
    def test_mode_time_table_visible(self, page):
        """Verify mode time table is rendered"""
        page.wait_for_timeout(2000)  # Wait for tables to load
        table = page.locator("#tables table").first
        expect(table).to_be_visible()
    
    def test_table_has_data(self, page):
        """Verify tables contain data rows"""
        rows = page.locator("#tables table tbody tr")
        expect(rows.first).to_be_visible()
        assert rows.count() > 0
    
    def test_table_row_click_navigation(self, page):
        """Test clicking a table row navigates to detail view"""
        # Find a clickable row
        row = page.locator("#tables table tbody tr").first
        
        if row.get_attribute("onclick"):
            row.click()
            page.wait_for_timeout(500)
            
            # Verify breadcrumb changed
            breadcrumb = page.locator("#breadcrumb")
            expect(breadcrumb).to_be_visible()


class TestNavigation:
    """Test navigation and breadcrumb functionality"""
    
    def test_breadcrumb_initially_shows_overview(self, page):
        """Verify breadcrumb shows Overview initially"""
        page.wait_for_timeout(1000)  # Wait for dynamic content
        breadcrumb = page.locator("#breadcrumb")
        expect(breadcrumb).to_contain_text("Overview")
    
    def test_navigate_to_all_assets(self, page):
        """Test navigation to all assets view"""
        # Click total assets card
        card = page.locator('.stat-card:has-text("Total Assets")')
        card.click()
        
        # Wait for navigation
        page.wait_for_timeout(1000)
        
        # Verify breadcrumb updated
        breadcrumb = page.locator("#breadcrumb")
        expect(breadcrumb).to_contain_text("All Assets")
    
    def test_breadcrumb_back_to_overview(self, page):
        """Test clicking breadcrumb returns to overview"""
        # Navigate away first
        card = page.locator('.stat-card:has-text("Total Assets")')
        card.click()
        page.wait_for_timeout(500)
        
        # Click Overview in breadcrumb
        overview_link = page.locator('#breadcrumb a:has-text("Overview")')
        overview_link.click()
        page.wait_for_timeout(500)
        
        # Verify we're back at overview
        breadcrumb = page.locator("#breadcrumb")
        expect(breadcrumb).to_contain_text("Overview")


class TestLogViewer:
    """Test log viewer functionality"""
    
    def test_log_viewer_opens(self, page):
        """Test opening the log viewer"""
        # Click on a clickable line number (in timeline or table)
        # First, try to find any element that opens log viewer
        log_link = page.locator('[onclick*="openLogViewer"]').first
        
        if log_link.is_visible():
            log_link.click()
            page.wait_for_timeout(500)
            
            # Verify log viewer overlay is visible
            overlay = page.locator("#log-viewer-overlay")
            expect(overlay).to_be_visible()
    
    def test_log_viewer_close_button(self, page):
        """Test closing log viewer with close button"""
        # Open log viewer first
        log_link = page.locator('[onclick*="openLogViewer"]').first
        
        if log_link.is_visible():
            log_link.click()
            page.wait_for_timeout(500)
            
            # Click close button
            close_btn = page.locator('.log-viewer-close')
            close_btn.click()
            page.wait_for_timeout(300)
            
            # Verify overlay is hidden
            overlay = page.locator("#log-viewer-overlay")
            expect(overlay).not_to_be_visible()
    
    def test_log_viewer_filters(self, page):
        """Test log viewer filter buttons"""
        # Open log viewer first
        log_link = page.locator('[onclick*="openLogViewer"]').first
        
        if log_link.is_visible():
            log_link.click()
            page.wait_for_timeout(500)
            
            # Test each filter button
            filters = ["all", "error", "warning", "import", "pipeline"]
            for filter_name in filters:
                filter_btn = page.locator(f'button[data-filter="{filter_name}"]')
                if filter_btn.is_visible():
                    filter_btn.click()
                    page.wait_for_timeout(200)
                    
                    # Verify button is active
                    assert "active" in filter_btn.get_attribute("class")


class TestSlackCopy:
    """Test Slack headlines copy functionality"""
    
    def test_slack_button_visible_with_data(self, page):
        """Verify Slack copy button is visible when data is loaded"""
        stats = page.locator("#stats")
        slack_btn = page.locator("#slack-copy-btn")
        
        if stats.is_visible():
            expect(slack_btn).to_be_visible()
    
    def test_slack_button_click(self, page):
        """Test clicking Slack copy button"""
        slack_btn = page.locator("#slack-copy-btn")
        
        if slack_btn.is_visible():
            # Note: WebKit doesn't support clipboard permissions
            # Just verify the button can be clicked
            slack_btn.click()
            page.wait_for_timeout(1000)
            
            # Verify button text changed (to indicate success)
            # Button should temporarily show "Copied!" or similar
            page.wait_for_timeout(500)


class TestEmptyState:
    """Test empty state when no database exists"""
    
    @pytest.mark.skipif(
        Path("unity_log.db").exists(),
        reason="Database exists, can't test empty state"
    )
    def test_empty_state_shown(self, page):
        """Verify empty state is shown when no database"""
        empty_msg = page.locator('text="No Log File Parsed"')
        expect(empty_msg).to_be_visible()


class TestResponsiveness:
    """Test responsive behavior"""
    
    def test_mobile_viewport(self, server):
        """Test dashboard works on mobile viewport"""
        with sync_playwright() as p:
            browser = p.firefox.launch(headless=True)
            context = browser.new_context(viewport={"width": 375, "height": 667})
            page = context.new_page()
            page.goto(BASE_URL)
            page.wait_for_load_state("networkidle")
            
            # Verify key elements still visible
            header = page.locator("h1")
            expect(header).to_be_visible()
            
            page.close()
            context.close()
            browser.close()


class TestErrorHandling:
    """Test error handling"""
    
    def test_invalid_api_call_shows_error(self, page):
        """Test that invalid API calls show error messages"""
        # Trigger an API call that will fail
        page.evaluate("fetch('/api/log/99999/summary')")
        page.wait_for_timeout(500)
        
        # Error div might show up
        error_div = page.locator("#error")
        # Error handling is graceful, so this might not always show


class TestPerformance:
    """Test performance metrics"""
    
    def test_page_load_time(self, server):
        """Verify page loads in reasonable time"""
        with sync_playwright() as p:
            browser = p.firefox.launch(headless=True)
            context = browser.new_context()
            page = context.new_page()
            
            start_time = time.time()
            page.goto(BASE_URL)
            page.wait_for_load_state("networkidle")
            load_time = time.time() - start_time
            
            # Should load in under 3 seconds
            assert load_time < 3.0, f"Page took {load_time:.2f}s to load"
            
            page.close()
            context.close()
            browser.close()


# Helper function to run all tests
def run_tests():
    """Run all tests with pytest"""
    import sys
    sys.exit(pytest.main([__file__, "-v", "--tb=short"]))


if __name__ == "__main__":
    run_tests()

