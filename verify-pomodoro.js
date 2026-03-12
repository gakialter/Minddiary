import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5173');
  
  // Wait a bit for React to render
  await page.waitForTimeout(2000);
  
  const pomodoroMain = await page.$('.pomodoro-container');
  const pomodoroWidget = await page.$('.pomodoro-mini');
  
  console.log('Pomodoro Main Found:', !!pomodoroMain);
  console.log('Pomodoro Widget Found:', !!pomodoroWidget);
  
  if (pomodoroWidget) {
    const box = await pomodoroWidget.boundingBox();
    const isVisible = await pomodoroWidget.isVisible();
    console.log('Widget Bounding Box:', box);
    console.log('Widget isVisible:', isVisible);
    
    // Evaluate CSS styles
    const styles = await page.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        display: computed.display,
        visibility: computed.visibility,
        zIndex: computed.zIndex,
        position: computed.position,
        left: computed.left,
        top: computed.top,
        opacity: computed.opacity
      };
    }, pomodoroWidget);
    console.log('Widget Computed Styles:', styles);
  }

  await browser.close();
})();
