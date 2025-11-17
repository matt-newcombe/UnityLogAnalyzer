#!/usr/bin/env python3
"""
Simple Playwright test to diagnose browser issues
"""

import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

# Test configuration
BASE_URL = "http://localhost:8765"
SERVER_STARTUP_TIME = 3


def test_chromium():
    """Test with Chromium"""
    print("\n🧪 Testing Chromium...")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            print("✅ Chromium launched successfully")
            
            page = browser.new_page()
            page.goto(BASE_URL)
            print(f"✅ Navigated to {BASE_URL}")
            print(f"✅ Page title: {page.title()}")
            
            browser.close()
            print("✅ Chromium test PASSED")
            return True
    except Exception as e:
        print(f"❌ Chromium test FAILED: {e}")
        return False


def test_webkit():
    """Test with WebKit"""
    print("\n🧪 Testing WebKit...")
    try:
        with sync_playwright() as p:
            browser = p.webkit.launch(headless=True)
            print("✅ WebKit launched successfully")
            
            page = browser.new_page()
            page.goto(BASE_URL)
            print(f"✅ Navigated to {BASE_URL}")
            print(f"✅ Page title: {page.title()}")
            
            browser.close()
            print("✅ WebKit test PASSED")
            return True
    except Exception as e:
        print(f"❌ WebKit test FAILED: {e}")
        return False


def test_chromium_non_headless():
    """Test with Chromium non-headless"""
    print("\n🧪 Testing Chromium (non-headless)...")
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False)
            print("✅ Chromium launched successfully (non-headless)")
            
            page = browser.new_page()
            page.goto(BASE_URL)
            print(f"✅ Navigated to {BASE_URL}")
            print(f"✅ Page title: {page.title()}")
            
            time.sleep(2)  # Let user see the browser
            browser.close()
            print("✅ Chromium non-headless test PASSED")
            return True
    except Exception as e:
        print(f"❌ Chromium non-headless test FAILED: {e}")
        return False


def main():
    """Run all tests"""
    print("=" * 60)
    print("Playwright Browser Diagnostics")
    print("=" * 60)
    
    # Check if server is running
    import urllib.request
    try:
        urllib.request.urlopen(BASE_URL, timeout=2)
        print(f"✅ Server is running at {BASE_URL}")
    except:
        print(f"⚠️  Server may not be running at {BASE_URL}")
        print("   Start with: python3 web_server.py")
        return
    
    results = {
        "Chromium (headless)": test_chromium(),
        "WebKit (headless)": test_webkit(),
        "Chromium (non-headless)": test_chromium_non_headless(),
    }
    
    print("\n" + "=" * 60)
    print("Results Summary:")
    print("=" * 60)
    for name, passed in results.items():
        status = "✅ PASSED" if passed else "❌ FAILED"
        print(f"{name}: {status}")
    
    print("\n" + "=" * 60)
    if any(results.values()):
        print("✅ At least one browser works! Use that for testing.")
        if results["WebKit (headless)"]:
            print("💡 Recommendation: Use WebKit for testing (most compatible on macOS)")
    else:
        print("❌ All browsers failed. Check Playwright installation.")


if __name__ == "__main__":
    main()

