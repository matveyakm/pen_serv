const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Разрешаем запросы с iOS-приложения
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Хранилище всех точек (для новых подключений)
let allDots = [];

// POST-эндпоинт для точек от ручки
app.post('/api/dot', (req, res) => {
  const dot = req.body;
  if (dot && 'x' in dot && 'y' in dot && 'dotType' in dot) {
    allDots.push(dot);
    
    // Рассылаем всем клиентам
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'new_dot', dot }));
        client.send(JSON.stringify({ type: 'activity_dot' }));
      }
    });
    
    console.log(`Получена точка: x=${dot.x}, y=${dot.y}, type=${dot.dotType}, time=${dot.time}`);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid dot data' });
  }
});

app.get('/health', (req, res) => {
    res.status(200).send('OK');
    console.log('Получен запрос здоровья активности');

    // Уведомляем всех браузеров
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'activity_health' }));
        }
    });
});

// Главная страница с холстом для просмотра + индикаторы
app.get('/', (req, res) => {
    res.send(`
  <!DOCTYPE html>
  <html lang="ru">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Live письмо с NeoSmartpen R1</title>
    <style>
      body { margin: 0; background: #f0f0f0; font-family: system-ui, sans-serif; position: relative; }
      canvas { display: block; margin: 20px auto; background: white; box-shadow: 0 8px 30px rgba(0,0,0,0.15); border-radius: 8px; }
      h1 { text-align: center; padding: 20px; color: #333; margin-bottom: 0; }
      button { display: block; margin: 20px auto; padding: 12px 24px; font-size: 18px; background: #007bff; color: white; border: none; border-radius: 8px; cursor: pointer; }
      button:hover { background: #0056b3; }

      /* Контейнер для индикаторов в правом верхнем углу */
      #indicators-container {
        position: fixed;           /* Фиксировано на экране */
        bottom: 40px;              /* Отступ от низа */
        right: 240px;               /* Отступ от правого края */
        display: flex;
        flex-direction: row;       /* В строку, как ты хотел */
        gap: 14px;
        z-index: 1000;             /* Поверх всего */
        pointer-events: none;      /* Чтобы не мешал кликам под ними */
      }

      .indicator {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        transition: all 0.3s ease;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 12px;
        font-weight: bold;
      }

      /* Разные размеры */
      #ws-indicator { 
        width: 40px; height: 40px; 
        background-color: red;
      }
      #health-indicator { background-color: red; }
      #dot-indicator { background-color: #aaa; }

      /* Таймер сверху круга */
      .timer-label {
        position: absolute;
        top: -20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.7);
        color: white;
        font-size: 11px;
        padding: 2px 6px;
        border-radius: 8px;
        opacity: 0;
        transition: opacity 0.3s;
        pointer-events: none;
      }

      .indicator.active .timer-label {
        opacity: 1;
      }
    </style>
  </head>
  <body>
    <h1>Письмо в реальном времени с NeoSmartpen R1</h1>
    <button onclick="clearCanvas()">Очистить холст</button>
    <canvas id="canvas"></canvas>

    <div id="indicators-container">
      <div id="ws-indicator" class="indicator"></div>
      <div id="health-indicator" class="indicator">
        <div class="timer-label">60s</div>
      </div>
      <div id="dot-indicator" class="indicator">
        <div class="timer-label">60s</div>
      </div>
    </div>
  
    <script>
      const canvas = document.getElementById('canvas');
      const ctx = canvas.getContext('2d');
  
      const PAGE_WIDTH_MM = 70;
      const PAGE_HEIGHT_MM = 90;
  
      let scaleX = 1, scaleY = 1;
      let offsetX = 0, offsetY = 0;
  
      let previousX = null;
      let previousY = null;

      // Индикаторы
      const wsIndicator = document.getElementById('ws-indicator');
      const healthIndicator = document.getElementById('health-indicator');
      const dotIndicator = document.getElementById('dot-indicator');
      const healthTimer = healthIndicator.querySelector('.timer-label');
      const dotTimer = dotIndicator.querySelector('.timer-label');

      let healthTimerId = null;
      let dotTimerId = null;

      function startTimer(indicator, timerLabel, color, currentTimerId) {
        // Если уже идёт таймер — останавливаем его
        if (currentTimerId !== null) {
          clearInterval(currentTimerId);
        }

        // Активируем индикатор
        indicator.style.backgroundColor = color;
        indicator.classList.add('active');
        
        let seconds = 0;
        timerLabel.textContent = seconds + 's';

        // Запускаем новый таймер и сохраняем его ID
        const newIntervalId = setInterval(() => {
          seconds++;
          timerLabel.textContent = seconds + 's';

          if (seconds >= 6) {
            indicator.style.backgroundColor = color == "green" ? '#aaa' : "red";
            
          }

          if (seconds >= 300) {
            clearInterval(newIntervalId);
            indicator.classList.remove('active');
            // Сбрасываем ID
            if (indicator === healthIndicator) healthTimerId = null;
            if (indicator === dotIndicator) dotTimerId = null;
        }       
        }, 1000);

        // Сохраняем новый ID
        if (indicator === healthIndicator) healthTimerId = newIntervalId;
        if (indicator === dotIndicator) dotTimerId = newIntervalId;
      }
    
      let buffer = [];  // Буфер для точек (чтобы избежать асинхронных скачков)
      let lastTime = 0;  // Для проверки порядка

      // WebSocket + основной индикатор (красный/зелёный)
      const ws = new WebSocket('ws://' + location.hostname + ':' + location.port);
  
      ws.onopen = () => {
        console.log('WS подключён');
        wsIndicator.style.backgroundColor = 'green';
        ws.send(JSON.stringify({ type: 'request_all_dots' }));
      };
  
      ws.onclose = ws.onerror = () => {
        console.log('WS отключён');
        wsIndicator.style.backgroundColor = 'red';
      };
  
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'all_dots') {
          data.dots.forEach(processDot);
        } else if (data.type === 'new_dot') {
          processDot(data.dot);
        } else if (data.type === 'activity_health') {
          startTimer(healthIndicator, healthTimer, '#007bff', healthTimerId);  // синий
        } else if (data.type === 'activity_dot') {
          startTimer(dotIndicator, dotTimer, 'green', dotTimerId);
        }
      };

        function processDot(dot) {
            buffer.push(dot);

            setTimeout(() => {
              buffer.sort((a, b) => a.time - b.time);

            // Отрисовываем только если порядок правильный
            requestAnimationFrame(drawFromBuffer);
            }, 200);

            // Сортируем буфер по time (на случай асинхронного прихода)
            
        }

        function drawFromBuffer() {
            while (buffer.length > 0) {
            const dot = buffer.shift();  // Берём по порядку

            console.log('Time:', dot.time);
            const force = dot.force || 0.5;
            const lineWidth = 0.4 + force * 0.8;

            const x = offsetX + dot.x * scaleX;
            const y = offsetY + dot.y * scaleY;

            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = lineWidth;

            if (dot.dotType === 0 || dot.dotType === undefined || previousX === null) {
                previousX = x;
                previousY = y;
            } else {
                ctx.beginPath();
                ctx.moveTo(previousX, previousY);
                ctx.lineTo(x, y);
                ctx.stroke();

                previousX = x;
                previousY = y;

                if (dot.dotType === 2) {
                previousX = null;
                previousY = null;
                }
            }
            }
        }
  
      function resizeCanvas() {
        const padding = 40;
        const cssWidth = window.innerWidth - padding * 2;
        const cssHeight = window.innerHeight - padding * 2;
  
        const dpr = window.devicePixelRatio || 1;
  
        canvas.style.width = cssWidth + 'px';
        canvas.style.height = cssHeight + 'px';
        canvas.width = cssWidth * dpr;
        canvas.height = cssHeight * dpr;
  
        ctx.scale(dpr, dpr);
  
        const ratio = PAGE_WIDTH_MM / PAGE_HEIGHT_MM;
  
        const extra = 0.8;  
  
        let drawWidth = cssWidth * extra;
        let drawHeight = cssHeight * extra;
  
        if (drawWidth / drawHeight > ratio) {
          drawWidth = drawHeight * ratio;
        } else {
          drawHeight = drawWidth / ratio;
        }
  
        scaleX = drawWidth / PAGE_WIDTH_MM;
        scaleY = drawHeight / PAGE_HEIGHT_MM;
  
        offsetX = (cssWidth - drawWidth) / 2;
        offsetY = (cssHeight - drawHeight) / 2;
  
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cssWidth, cssHeight);
        ctx.fillStyle = '#fafafa';
        ctx.fillRect(offsetX, offsetY, drawWidth, drawHeight);
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth = 1;
        ctx.strokeRect(offsetX, offsetY, drawWidth, drawHeight);
  
        previousX = null;
        previousY = null;
        allDots.forEach(processDot);
      }

      window.onresize = resizeCanvas;
      resizeCanvas();

      function clearCanvas() {
        allDots = [];
        previousX = null;
        previousY = null;
        resizeCanvas();
      }
    </script>
  </body>
  </html>
    `);
});

// Обработка запроса всех точек
wss.on('connection', (ws) => {
  console.log('Новый зритель подключён');
  ws.send(JSON.stringify({ type: 'all_dots', dots: allDots }));

  ws.on('message', (message) => {
    const data = JSON.parse(message);
    if (data.type === 'request_all_dots') {
      ws.send(JSON.stringify({ type: 'all_dots', dots: allDots }));
    }
  });
  
  ws.on('close', () => console.log('Зритель отключён'));
});

const PORT = 5252;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Сервер запущен!`);
  console.log(`Открой в браузере: http://localhost:${PORT}`);
  console.log(`Или с другого устройства: http://${getLocalIP()}:${PORT}\n`);
});

function getLocalIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}
