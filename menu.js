// Simple React-based menu bar for Froggy Flash
// Uses the global React and ReactDOM objects loaded from UMD bundles.

const { useState, useEffect, useRef } = React;

function useClickOutside(ref, onClickOutside) {
  useEffect(() => {
    function handleClick(event) {
      if (!ref.current) return;
      if (!ref.current.contains(event.target)) {
        onClickOutside();
      }
    }

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('contextmenu', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('contextmenu', handleClick);
    };
  }, [ref, onClickOutside]);
}

function MenuBar() {
  const [openMenu, setOpenMenu] = useState(null);
  const fileRef = useRef(null);

  useClickOutside(fileRef, () => {
    if (openMenu !== null) {
      setOpenMenu(null);
    }
  });

  function toggleFileMenu() {
    setOpenMenu((prev) => (prev === 'file' ? null : 'file'));
  }

  async function handleExitClick() {
    try {
      if (window.froggyApi && typeof window.froggyApi.exitApp === 'function') {
        await window.froggyApi.exitApp();
      } else {
        window.close();
      }
    } catch (err) {
      console.error('Failed to exit app:', err);
      window.close();
    }
  }

  return React.createElement(
    'div',
    { className: 'menu-bar' },
    React.createElement(
      'div',
      {
        className: 'menu-bar-item',
        ref: fileRef
      },
      React.createElement(
        'div',
        {
          className: 'menu-bar-item-label',
          onClick: toggleFileMenu
        },
        'File'
      ),
      openMenu === 'file'
        ? React.createElement(
            'div',
            { className: 'menu-dropdown' },
            React.createElement(
              'div',
              {
                className: 'menu-dropdown-item',
                onClick: handleExitClick
              },
              React.createElement('span', null, 'Exit'),
              React.createElement(
                'span',
                { className: 'menu-dropdown-item-accelerator' },
                'Alt+F4'
              )
            )
          )
        : null
    )
  );
}

window.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('menu-root');
  if (root && window.ReactDOM && window.React) {
    ReactDOM.createRoot(root).render(React.createElement(MenuBar));
  }
});


