# Dashboard Testing Guide

## Setup

1. Install test dependencies:
```bash
pip3 install -r requirements-test.txt
```

2. Install Playwright browsers:
```bash
playwright install chromium
```

## Running Tests

Run all tests:
```bash
python3 test_dashboard.py
```

Or use pytest directly:
```bash
pytest test_dashboard.py -v
```

Run specific test class:
```bash
pytest test_dashboard.py::TestCharts -v
```

Run specific test:
```bash
pytest test_dashboard.py::TestCharts::test_type_count_chart_rendered -v
```

## Test Coverage

The test suite covers:

- ✅ **Page Loading**: Initial load, header, navigation buttons
- ✅ **Stats Cards**: Display, values, clickability
- ✅ **Charts**: Rendering, interactions, click navigation
- ✅ **Tables**: Data display, row interactions
- ✅ **Navigation**: Breadcrumbs, view switching, back navigation
- ✅ **Log Viewer**: Opening, closing, filters
- ✅ **Slack Copy**: Button visibility, click behavior
- ✅ **Empty State**: No database handling
- ✅ **Responsiveness**: Mobile viewport testing
- ✅ **Performance**: Load time verification

## Before Refactoring

Run the full test suite to establish baseline:
```bash
pytest test_dashboard.py -v --tb=short
```

All tests should pass before starting refactoring.

## After Refactoring

Run the same test suite to verify no functionality was broken:
```bash
pytest test_dashboard.py -v --tb=short
```

All tests should still pass after refactoring is complete.

