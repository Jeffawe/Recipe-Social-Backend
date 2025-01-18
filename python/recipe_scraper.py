import time
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin
import pandas as pd
import re
from joblib import load

def prepare_features(features):
    # Create a DataFrame with a single row
    df = pd.DataFrame(features, index=[0])
    prepared_features = df.drop(['url'], axis=1)

    # Make sure columns match training data
    expected_columns = [
        'cooking_verb_count', 'measurement_term_count', 'nutrition_term_count',
        'number_count', 'time_mentions', 'temperature_mentions', 'list_count',
        'image_count', 'total_text_length', 'has_schema_recipe',
        'recipe_class_indicators', 'list_text_ratio', 'has_print_button',
        'has_servings', 'title_contains_recipe', 'meta_description_contains_recipe',
        'category_mentions', 'link_to_text_ratio', 'url_is_generic'
    ]

    # Return DataFrame with columns in correct order
    return prepared_features


def is_recipe_site(features):
    loaded_pipeline = load('./trained_pipeline.joblib')
    prepared_features = prepare_features(features)
    value = loaded_pipeline.predict(prepared_features)
    if value[0] == 0:
        return False
    else:
        return True


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
            'has_servings': 1 if re.search(r'serves?|servings?|yield', text_content) else 0,
            'title_contains_recipe': 1 if 'recipe' in soup.title.string.lower() else 0,
            'meta_description_contains_recipe': 1 if soup.find('meta', attrs={'name': 'description'}) and 'recipe' in
                                                     soup.find('meta', attrs={'name': 'description'})['content'].lower() else 0,
            'category_mentions': len(re.findall(r'dessert|appetizer|main course|breakfast|dinner', text_content)),
            'link_to_text_ratio': len(soup.find_all('a', href=True)) / (len(text_content) + 1),
            'url_is_generic': 1 if re.search(r'/home|/categories|/recipes$', url) else 0
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
                text_content = soup.get_text(separator=' ', strip=True).lower()
                if len(soup.find_all('a', href=True)) / len(text_content.split()) > 0.5:
                    return None, []

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

    def crawl_sites(self, start_urls, visited_urls, train=True, max_pages=100, max_depth=3, delay=1):
        all_visited_urls = set(self.visited_urls).union(set(visited_urls))
        urls_to_visit = [(url, 0) for url in start_urls]  # Start with depth 0

        while urls_to_visit and len(self.visited_urls) < max_pages:
            url, depth = urls_to_visit.pop(0)
            
            if depth > max_depth or url in all_visited_urls:
                continue

            print(f"Visiting: {url} (Depth: {depth})")
            features, new_urls = self.crawl_page(url)

            if features:
                if not train and is_recipe_site(features):
                    self.features_data.append(features)

            self.visited_urls.add(url)  # Mark as visited
            urls_to_visit.extend([(new_url, depth + 1) for new_url in new_urls if new_url not in self.visited_urls])

            time.sleep(delay)  # Add delay between requests

        return pd.DataFrame(self.features_data).set_index('url', drop=False)

