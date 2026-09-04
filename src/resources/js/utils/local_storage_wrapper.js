export const localStorageWrapper = {
  /**
   * Get value corresponding to the key from localStorage
   * @param {string} key
   * @returns {string|null}
   */
  get: (key) => {
    let value = null;
    try {
      value = localStorage.getItem(key);
    } catch (err) {
      console.error(err);
    }
    return value;
  },

  /*
   * Set key-value pair to the localStorage
   * @param {string} key
   * @param {string} value
   */
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.error(err);
    }
  },

  /**
   * Remove the key from localStorage, so that a later `get` reports "never
   * set" rather than a stale value. Used to retire a saved preference whose
   * default has changed -- clearing it lets the new default apply, while
   * writing the new default instead would pin the machine to today's value
   * forever.
   * @param {string} key
   */
  remove: (key) => {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.error(err);
    }
  },
};
