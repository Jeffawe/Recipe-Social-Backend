import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin
import pandas as pd
import re

class RecipeCrawler:
    def __init__(self):
        self.cooking_verbs = {'bake', 'boil', 'broil', 'chop', 'cook', 'dice', 'fry', 'grate', 'grill', 'mince', 'mix',
                              'peel', 'roast', 'simmer', 'slice', 'stir', 'whisk'}

        self.measurement_terms = {'cup', 'tablespoon', 'teaspoon', 'gram', 'ounce', 'pound', 'ml', 'g', 'kg', 'oz',
                                  'lb', 'pinch', 'dash'}

        self.nutrition_terms = {'calories', 'protein', 'fat', 'carbohydrates', 'fiber', 'sugar', 'sodium'}

        self.headers = {
            'User-Agent': 'Recipe-Collector-Bot/1.0 (Educational Purpose)'
        }

        self.visited_urls = set()
        self.features_data = []

    def extract_features(self, soup, url):
        """Extract relevant features from a webpage."""
        # Get text content
        text_content = soup.get_text(separator=' ', strip=True).lower()

        # Get all text within list items for better ratio calculation
        list_items_text = ' '.join(li.get_text(strip=True) for li in soup.find_all(['li']))

        # Extract features
        features = {
            'url': url,
            'cooking_verb_count': sum(text_content.count(verb) for verb in self.cooking_verbs),
            'measurement_term_count': sum(text_content.count(term) for term in self.measurement_terms),
            'nutrition_term_count': sum(text_content.count(term) for term in self.nutrition_terms),
            'number_count': len(re.findall(r'\d+(?:\.\d+)?', text_content)),
            'time_mentions': len(re.findall(r'\d+\s*(?:minute|hour|min|hr)', text_content)),
            'temperature_mentions': len(re.findall(r'\d+\s*(?:degrees?|°|fahrenheit|celsius|f\b|c\b)', text_content)),
            'list_count': len(soup.find_all(['ul', 'ol'])),
            'image_count': len(soup.find_all('img')),
            'total_text_length': len(text_content),
            'has_schema_recipe': 1 if soup.find('script', {'type': 'application/ld+json'}) else 0,
            'recipe_class_indicators': len(re.findall(r'recipe|ingredient|instruction|method|direction',
                                                      str(soup.find_all(['class', 'id'])))),
            'list_text_ratio': len(list_items_text) / (len(text_content) if len(text_content) > 0 else 1),
            'has_print_button': 1 if soup.find('a', text=re.compile(r'print|save', re.I)) else 0,
            'has_servings': 1 if re.search(r'serves?|servings?|yield', text_content) else 0
        }

        return features

    def crawl_page(self, url, external=False):
        """Crawl a single page and extract features."""
        if external:
            if url in self.visited_urls:
                return None, []


        try:
            response = requests.get(url, headers=self.headers, timeout=10)
            if not external: self.visited_urls.add(url)

            if response.status_code == 200:
                soup = BeautifulSoup(response.text, 'html.parser')
                features = self.extract_features(soup, url)

                # Find all links on the page
                links = []
                for link in soup.find_all('a', href=True):
                    next_url = urljoin(url, link['href'])
                    if next_url.startswith('http'):
                        links.append(next_url)

                return features, links

        except Exception as e:
            print(f"Error crawling {url}: {str(e)}")
            return None, []

        return None, []

    def crawl_sites(self, start_urls, max_pages=100):
        """
        Crawl multiple sites starting from given URLs.

        Args:
            start_urls (list): List of URLs to start crawling from
            max_pages (int): Maximum number of pages to crawl

        Returns:
            pandas.DataFrame: DataFrame containing features for all crawled pages
        """
        urls_to_visit = start_urls.copy()

        while urls_to_visit and len(self.visited_urls) < max_pages:
            url = urls_to_visit.pop(0)
            features, new_urls = self.crawl_page(url)

            if features:
                self.features_data.append(features)

            # Add new URLs to visit
            urls_to_visit.extend([url for url in new_urls if url not in self.visited_urls])

        # Convert features to DataFrame
        df = pd.DataFrame(self.features_data)

        # Set URL as index but keep it as a column too
        df.set_index('url', inplace=True, drop=False)

        return df