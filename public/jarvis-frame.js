// Runs inside the Hub's Jarvis page (/hub/jarvis).
//
// The frame points at Jarvis's own UI server on a different port, i.e. a
// different origin, so a failed load cannot be inspected directly: reading
// frame.contentWindow.location throws cross-origin, and no 'error' event is
// fired for a refused connection. What *is* reliable is that 'load' fires when
// the framed document actually arrives — so a timer that finds no load after a
// few seconds is our "Jarvis isn't running" signal.
(function () {
  var frame = document.getElementById('frame');
  var down = document.getElementById('down');
  if (!frame || !down) return;

  var loaded = false;
  frame.addEventListener('load', function () {
    loaded = true;
    down.style.display = 'none';
    frame.style.display = '';
  });

  window.setTimeout(function () {
    if (!loaded) {
      frame.style.display = 'none';
      down.style.display = 'block';
    }
  }, 4000);
})();
