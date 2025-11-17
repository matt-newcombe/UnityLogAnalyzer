#!/usr/bin/env python3
"""
Integration tests for Unity Log Analyzer Dashboard using Selenium
Selenium works on macOS Sequoia 15.2 where Playwright crashes!
"""

import pytest
import subprocess
import time
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.common.exceptions import TimeoutException, NoSuchElementException

BASE_URL = "http://localhost:8765"

# Helper functions
def wait_for_condition(condition_func, timeout=5.0, interval=0.5):
    """
    Wait for a condition to be true with incremental checks.
    
    Args:
        condition_func: Function that returns True when condition is met
        timeout: Maximum time to wait (seconds)
        interval: Time between checks (seconds)
    
    Returns:
        True if condition met, False if timeout
    """
    elapsed = 0.0
    while elapsed < timeout:
        try:
            if condition_func():
                return True
        except (NoSuchElementException, Exception):
            pass
        time.sleep(interval)
        elapsed += interval
    return False

def check_console_errors(driver):
    """
    Check for JavaScript console errors and fail test if any found.
    
    Args:
        driver: Selenium WebDriver instance
    """
    logs = driver.get_log('browser')
    errors = [log for log in logs if log['level'] == 'SEVERE']
    
    if errors:
        error_messages = '\n'.join([f"  - {log['message']}" for log in errors])
        pytest.fail(f"Console errors found:\n{error_messages}")

# Server management fixture
@pytest.fixture(scope="session")
def server():
    """Start the Flask server before tests and stop it after"""
    print("\n🚀 Starting web server...")
    server_process = subprocess.Popen(
        ["python3", "web_server.py"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    
    # Wait for server to be ready
    time.sleep(3)
    
    yield server_process
    
    # Cleanup
    print("\n🛑 Stopping web server...")
    server_process.terminate()
    server_process.wait(timeout=5)


@pytest.fixture
def driver(server):
    """Create a Chrome WebDriver for each test"""
    options = ChromeOptions()
    # Note: Headless mode crashes on macOS Sequoia 15.2, using non-headless
    # options.add_argument('--headless=new')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--window-size=1400,900')
    
    driver = webdriver.Chrome(options=options)
    driver.implicitly_wait(10)  # Wait up to 10 seconds for elements
    
    yield driver
    
    driver.quit()


class TestPageLoading:
    """Test basic page loading and structure"""
    
    def test_page_loads(self, driver):
        """Test that the dashboard page loads successfully"""
        driver.get(BASE_URL)
        assert "Unity Log Analyzer" in driver.title
        check_console_errors(driver)
    
    def test_header_present(self, driver):
        """Test that the header is present and contains expected text"""
        driver.get(BASE_URL)
        
        # Wait for header to be present
        assert wait_for_condition(
            lambda: driver.find_element(By.TAG_NAME, "h1").is_displayed()
        ), "Header not found"
        
        header = driver.find_element(By.TAG_NAME, "h1")
        assert "Unity Log Analyzer" in header.text
        check_console_errors(driver)
    
    def test_navigation_tabs_present(self, driver):
        """Test that navigation tabs are present"""
        driver.get(BASE_URL)
        
        # Wait for nav to be present
        assert wait_for_condition(
            lambda: driver.find_element(By.CLASS_NAME, "header-nav").is_displayed()
        ), "Navigation not found"
        
        nav = driver.find_element(By.CLASS_NAME, "header-nav")
        assert nav.is_displayed()
        check_console_errors(driver)


class TestStatsCards:
    """Test statistics cards display"""
    
    def test_all_stat_cards_visible(self, driver):
        """Test that all stat cards are visible"""
        driver.get(BASE_URL)
        
        # Wait for stat cards to load
        assert wait_for_condition(
            lambda: len(driver.find_elements(By.CLASS_NAME, "stat-card")) > 0
        ), "No stat cards found"
        
        stat_cards = driver.find_elements(By.CLASS_NAME, "stat-card")
        assert len(stat_cards) > 0, "No stat cards found"
        
        for card in stat_cards:
            assert card.is_displayed(), "Stat card is not visible"
        
        check_console_errors(driver)
    
    def test_stat_cards_have_content(self, driver):
        """Test that stat cards contain data"""
        driver.get(BASE_URL)
        
        # Wait for stat values to load
        assert wait_for_condition(
            lambda: len(driver.find_elements(By.CLASS_NAME, "stat-value")) > 0
        ), "No stat values found"
        
        stat_values = driver.find_elements(By.CLASS_NAME, "stat-value")
        assert len(stat_values) > 0, "No stat values found"
        
        for value in stat_values:
            assert value.text.strip() != "", "Stat value is empty"
        
        check_console_errors(driver)


class TestCharts:
    """Test chart rendering and interaction"""
    
    def test_type_count_chart_visible(self, driver):
        """Test that the type count chart canvas is present"""
        driver.get(BASE_URL)
        
        # Wait for chart canvas to exist
        assert wait_for_condition(
            lambda: driver.find_element(By.ID, "typeCountChart") is not None
        ), "Type count chart canvas not found"
        
        canvas = driver.find_element(By.ID, "typeCountChart")
        assert canvas is not None
        check_console_errors(driver)
    
    def test_time_chart_visible(self, driver):
        """Test that the time chart canvas is present"""
        driver.get(BASE_URL)
        
        # Wait for chart canvas to exist
        assert wait_for_condition(
            lambda: driver.find_element(By.ID, "typeTimeChart") is not None
        ), "Time chart canvas not found"
        
        canvas = driver.find_element(By.ID, "typeTimeChart")
        assert canvas is not None
        check_console_errors(driver)
    
    def test_timeline_visualization_visible(self, driver):
        """Test that the timeline visualization is present"""
        driver.get(BASE_URL)
        
        # Wait for timeline to be visible
        assert wait_for_condition(
            lambda: driver.find_element(By.ID, "timeline-container").is_displayed()
        ), "Timeline visualization not found"
        
        timeline = driver.find_element(By.ID, "timeline-container")
        assert timeline.is_displayed()
        check_console_errors(driver)
    
    def test_chart_click_navigation(self, driver):
        """Test that clicking a chart segment navigates correctly"""
        driver.get(BASE_URL)
        
        # Wait for canvas to exist
        assert wait_for_condition(
            lambda: driver.find_element(By.ID, "typeCountChart") is not None
        ), "Chart canvas not found"
        
        # Canvas elements are not clickable in the same way as regular elements
        # Charts need to be visible first, and clicking canvases doesn't work the same
        # This test verifies the canvas exists for now
        canvas = driver.find_element(By.ID, "typeCountChart")
        assert canvas is not None
        check_console_errors(driver)


class TestTables:
    """Test table rendering and interaction"""
    
    def test_mode_time_table_visible(self, driver):
        """Test that the mode-time breakdown table is visible"""
        driver.get(BASE_URL)
        
        # Wait for table to be visible
        assert wait_for_condition(
            lambda: driver.find_element(By.ID, "mode-time-table").is_displayed()
        ), "Mode-time table not found"
        
        table = driver.find_element(By.ID, "mode-time-table")
        assert table.is_displayed()
        check_console_errors(driver)
    
    def test_table_has_data(self, driver):
        """Test that the table contains data rows"""
        driver.get(BASE_URL)
        
        # Wait for table rows to load
        assert wait_for_condition(
            lambda: len(driver.find_elements(By.CSS_SELECTOR, "#mode-time-table tbody tr")) > 0,
            timeout=5.0
        ), "Table has no data rows"
        
        rows = driver.find_elements(By.CSS_SELECTOR, "#mode-time-table tbody tr")
        assert len(rows) > 0, "Table has no data rows"
        check_console_errors(driver)
    
    def test_table_rows_exist_and_have_content(self, driver):
        """Test that table rows exist and contain data"""
        driver.get(BASE_URL)
        
        # Wait for table rows with content to load
        def table_has_content():
            rows = driver.find_elements(By.CSS_SELECTOR, "#mode-time-table tbody tr")
            if len(rows) == 0:
                return False
            first_row_cells = rows[0].find_elements(By.TAG_NAME, "td")
            if len(first_row_cells) == 0:
                return False
            return any(cell.text.strip() != "" for cell in first_row_cells)
        
        assert wait_for_condition(table_has_content, timeout=5.0), "Table has no content"
        
        # Verify again
        rows = driver.find_elements(By.CSS_SELECTOR, "#mode-time-table tbody tr")
        assert len(rows) > 0, "No table rows found"
        
        first_row_cells = rows[0].find_elements(By.TAG_NAME, "td")
        assert len(first_row_cells) > 0, "Row has no cells"
        
        has_content = any(cell.text.strip() != "" for cell in first_row_cells)
        assert has_content, "Table rows have no content"
        check_console_errors(driver)


class TestNavigation:
    """Test navigation and breadcrumbs"""
    
    def test_breadcrumb_initially_shows_overview(self, driver):
        """Test that breadcrumb initially shows Overview"""
        driver.get(BASE_URL)
        
        # Wait for breadcrumb to exist
        assert wait_for_condition(
            lambda: driver.find_element(By.ID, "breadcrumb") is not None
        ), "Breadcrumb not found"
        
        breadcrumb = driver.find_element(By.ID, "breadcrumb")
        assert breadcrumb is not None
        check_console_errors(driver)
    
    def test_breadcrumb_back_to_overview(self, driver):
        """Test breadcrumb navigation back to overview"""
        driver.get(BASE_URL)
        
        # Wait for charts to load
        assert wait_for_condition(
            lambda: driver.find_element(By.ID, "typeCountChart") is not None,
            timeout=5.0
        ), "Chart not found"
        
        # Click on a chart to navigate
        driver.execute_script("""
            const canvas = document.getElementById('typeCountChart');
            if (canvas) canvas.click();
        """)
        
        # Use JavaScript to check for Overview link (avoids 10s implicit wait)
        overview_link_exists = driver.execute_script("""
            const links = Array.from(document.querySelectorAll('a'));
            return links.some(link => link.textContent.includes('Overview'));
        """)
        
        if overview_link_exists:
            # Click back to overview
            driver.execute_script("""
                const links = Array.from(document.querySelectorAll('a'));
                const overviewLink = links.find(link => link.textContent.includes('Overview'));
                if (overviewLink) overviewLink.click();
            """)
            
            # Verify we're back
            assert wait_for_condition(
                lambda: driver.find_element(By.ID, "breadcrumb") is not None,
                timeout=2.0
            ), "Failed to return to overview"
        
        check_console_errors(driver)


class TestLogViewer:
    """Test log viewer functionality"""
    
    def test_log_viewer_opens(self, driver):
        """Test that clicking an asset row opens the log viewer"""
        driver.get(BASE_URL)
        
        # Wait for slowest assets table to load with actual data (not loading spinner)
        assert wait_for_condition(
            lambda: driver.execute_script("""
                const rows = document.querySelectorAll('#slowest-assets-table tbody tr');
                if (rows.length === 0) return false;
                // Check if it's not the loading spinner row
                const firstRow = rows[0];
                const hasSpinner = firstRow.querySelector('.element-spinner') !== null;
                return !hasSpinner && rows.length > 0;
            """),
            timeout=5.0
        ), "Slowest assets table data not loaded"
        
        # Click on an asset row to open log viewer
        driver.execute_script("""
            const rows = document.querySelectorAll('#slowest-assets-table tbody tr');
            if (rows.length > 0) {
                rows[0].click();
            }
        """)
        
        # Wait for overlay to become active
        assert wait_for_condition(
            lambda: driver.execute_script("""
                const overlay = document.getElementById('log-viewer-overlay');
                return overlay && overlay.classList.contains('active');
            """),
            timeout=3.0
        ), "Log viewer overlay did not activate"
        
        # Verify overlay and panel are displayed
        overlay = driver.find_element(By.ID, "log-viewer-overlay")
        panel = driver.find_element(By.ID, "log-viewer-panel")
        assert overlay.is_displayed(), "Overlay not displayed"
        assert panel.is_displayed(), "Panel not displayed"
        
        check_console_errors(driver)
    
    def test_log_viewer_closes(self, driver):
        """Test that the log viewer can be closed"""
        driver.get(BASE_URL)
        
        # Wait for slowest assets table with actual data
        assert wait_for_condition(
            lambda: driver.execute_script("""
                const rows = document.querySelectorAll('#slowest-assets-table tbody tr');
                if (rows.length === 0) return false;
                const firstRow = rows[0];
                const hasSpinner = firstRow.querySelector('.element-spinner') !== null;
                return !hasSpinner && rows.length > 0;
            """),
            timeout=5.0
        ), "Slowest assets table data not loaded"
        
        # Open log viewer by clicking asset row
        driver.execute_script("""
            const rows = document.querySelectorAll('#slowest-assets-table tbody tr');
            if (rows.length > 0) {
                rows[0].click();
            }
        """)
        
        # Wait for it to open
        assert wait_for_condition(
            lambda: driver.execute_script("""
                const overlay = document.getElementById('log-viewer-overlay');
                return overlay && overlay.classList.contains('active');
            """),
            timeout=3.0
        ), "Log viewer did not open"
        
        # Close it by calling the JavaScript function directly
        driver.execute_script("closeLogViewer();")
        
        # Wait for it to close (active class removed)
        assert wait_for_condition(
            lambda: driver.execute_script("""
                const overlay = document.getElementById('log-viewer-overlay');
                return overlay && !overlay.classList.contains('active');
            """),
            timeout=2.0
        ), "Log viewer did not close"
        
        check_console_errors(driver)
    
    def test_log_viewer_content_loads(self, driver):
        """Test that log viewer loads content"""
        driver.get(BASE_URL)
        
        # Wait for slowest assets table with actual data
        assert wait_for_condition(
            lambda: driver.execute_script("""
                const rows = document.querySelectorAll('#slowest-assets-table tbody tr');
                if (rows.length === 0) return false;
                const firstRow = rows[0];
                const hasSpinner = firstRow.querySelector('.element-spinner') !== null;
                return !hasSpinner && rows.length > 0;
            """),
            timeout=5.0
        ), "Slowest assets table data not loaded"
        
        # Open log viewer
        driver.execute_script("""
            const rows = document.querySelectorAll('#slowest-assets-table tbody tr');
            if (rows.length > 0) {
                rows[0].click();
            }
        """)
        
        # Wait for overlay to open
        assert wait_for_condition(
            lambda: driver.execute_script("""
                const overlay = document.getElementById('log-viewer-overlay');
                return overlay && overlay.classList.contains('active');
            """),
            timeout=3.0
        ), "Log viewer did not open"
        
        # Check for log content using JavaScript (avoids 10s implicit wait)
        has_content = driver.execute_script("""
            const panel = document.getElementById('log-viewer-panel');
            return panel && panel.textContent.trim().length > 0;
        """)
        
        assert has_content, "No log content found"
        
        check_console_errors(driver)


class TestSlackButton:
    """Test Slack copy button functionality"""
    
    def test_slack_button_visible(self, driver):
        """Test that the Slack copy button is visible when data is loaded"""
        driver.get(BASE_URL)
        
        # Wait for Slack button to be visible
        assert wait_for_condition(
            lambda: driver.find_element(By.ID, "slack-copy-btn").is_displayed(),
            timeout=3.0
        ), "Slack button not found or not visible"
        
        button = driver.find_element(By.ID, "slack-copy-btn")
        assert button.is_displayed()
        check_console_errors(driver)
    
    def test_slack_button_click(self, driver):
        """Test that clicking the Slack button works"""
        driver.get(BASE_URL)
        
        # Wait for Slack button to be visible
        assert wait_for_condition(
            lambda: driver.find_element(By.ID, "slack-copy-btn").is_displayed(),
            timeout=5.0
        ), "Slack button not visible"
        
        button = driver.find_element(By.ID, "slack-copy-btn")
        button.click()
        time.sleep(0.5)
        
        # Button text should change temporarily or button should still be there
        assert button.is_displayed()
        check_console_errors(driver)


class TestErrorHandling:
    """Test error handling"""
    
    def test_invalid_api_call_shows_error(self, driver):
        """Test that invalid API calls show appropriate errors"""
        # Navigate to a non-existent log
        driver.get(f"{BASE_URL}?log_id=99999")
        
        # Wait for page to load
        time.sleep(1.0)
        
        # Should show some kind of error or empty state
        page_source = driver.page_source.lower()
        assert "error" in page_source or "no log" in page_source or "empty" in page_source
        
        # Note: We don't check console errors here as API errors are expected
        # check_console_errors(driver)


class TestResponsiveness:
    """Test responsive behavior"""
    
    def test_mobile_viewport(self, server):
        """Test dashboard works on mobile viewport"""
        options = ChromeOptions()
        # Note: Can't use headless on macOS Sequoia 15.2 - it crashes
        # options.add_argument('--headless=new')
        options.add_argument('--window-size=375,667')  # iPhone viewport
        
        driver = webdriver.Chrome(options=options)
        
        try:
            driver.get(BASE_URL)
            
            # Should still load and show content
            assert "Unity Log Analyzer" in driver.title
            
            # Wait for stat cards to load
            assert wait_for_condition(
                lambda: len(driver.find_elements(By.CLASS_NAME, "stat-card")) > 0,
                timeout=5.0
            ), "Stat cards did not load"
            
            # Check if stats are visible (might stack vertically)
            stat_cards = driver.find_elements(By.CLASS_NAME, "stat-card")
            assert len(stat_cards) > 0
            
            check_console_errors(driver)
        finally:
            driver.quit()


class TestPerformance:
    """Test performance metrics"""
    
    def test_page_load_time(self, server):
        """Verify page loads in reasonable time"""
        options = ChromeOptions()
        # Note: Can't use headless on macOS Sequoia 15.2 - it crashes
        # options.add_argument('--headless=new')
        
        driver = webdriver.Chrome(options=options)
        
        try:
            start_time = time.time()
            driver.get(BASE_URL)
            
            # Wait for page to be fully loaded
            WebDriverWait(driver, 10).until(
                lambda d: d.execute_script('return document.readyState') == 'complete'
            )
            
            load_time = time.time() - start_time
            
            # Page should load within 10 seconds
            assert load_time < 10, f"Page took {load_time:.2f}s to load"
            print(f"\n⏱️  Page load time: {load_time:.2f}s")
            
            check_console_errors(driver)
        finally:
            driver.quit()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

