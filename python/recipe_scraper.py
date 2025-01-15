import requests
from bs4 import BeautifulSoup
import pandas as pd
import re
from urllib.parse import urlparse
import logging
from datetime import datetime
from time import sleep
import argparse
from prediction_module import predict_recipe_page  # Import your prediction function

class RecipeScraper:
    def __init__(self):
        self.cooking_verbs = set(['bake', 'boil', 'broil', 'chop', 'cook', 'dice',
                                  'fry', 'grate', 'grill', 'mince', 'mix', 'peel',
                                  'roast', 'simmer', 'slice', 'stir', 'whisk'])
        
        self.measurement_terms = set(['cup', 'tablespoon', 'teaspoon', 'gram',
                                      'ounce', 'pound', 'ml', 'g', 'kg', 'oz', 'lb',
                                      'pinch', 'dash'])
        
        self.nutrition_terms = set(['calories', 'protein', 'fat', 'carbohydrates',
                                    'fiber', 'sugar', 'sodium'])
        
        self.headers = {
            'User-Agent': 'Recipe-Collector-Bot/1.0 (Educational Purpose)'
        }
        
        # Setup logging
        logging.basicConfig(filename=f'scraping_{datetime.now().strftime("%Y%m%d")}.log',
                            level=logging.INFO,
                            format='%(asctime)s - %(levelname)s - %(message)s')

    def get_page_content(self, url):
        """Fetch page content with error handling and rate limiting."""
        try:
            response = requests.get(url, headers=self.headers, timeout=10)
            response.raise_for_status()
            sleep(2)  # Rate limiting
            return response.text
        except Exception as e:
            logging.error(f"Error fetching {url}: {str(e)}")
            return None

    def extract_features(self, url, html_content):
        """Extract features from a page."""
        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            text_content = soup.get_text().lower()
            
            # Extract features
            features = {
                'url': url,
                'domain': urlparse(url).netloc,
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
                'list_text_ratio': len(''.join(str(tag) for tag in soup.find_all(['ul', 'ol']))) /
                                 (len(text_content) if len(text_content) > 0 else 1)
            }
            return features
        except Exception as e:
            logging.error(f"Error extracting features from {url}: {str(e)}")
            return None

    def save_to_csv(self, features, filename='recipe_features.csv'):
        """Save features to a CSV file."""
        try:
            df = pd.DataFrame([features])
            file_exists = pd.io.common.file_exists(filename)
            df.to_csv(filename, mode='a', header=not file_exists, index=False)
            logging.info(f"Successfully saved features for {features['url']}")
        except Exception as e:
            logging.error(f"Error saving features to CSV: {str(e)}")

    def process_urls(self, urls, mode):
        """Process URLs based on the mode (train or predict)."""
        if mode == 'train':
            for url in urls:
                logging.info(f"Processing {url} for training.")
                html_content = self.get_page_content(url)
                if html_content:
                    features = self.extract_features(url, html_content)
                    if features:
                        self.save_to_csv(features)
                sleep(2)  # Rate limiting between requests
        elif mode == 'predict':
            results = []
            for url in urls:
                logging.info(f"Processing {url} for prediction.")
                html_content = self.get_page_content(url)
                if html_content:
                    features = self.extract_features(url, html_content)
                    if features:
                        results.append(features)
                sleep(2)  # Rate limiting between requests
            if results:
                df = pd.DataFrame(results)
                predictions = predict_recipe_page(df)  # Call your prediction function
                print(predictions.to_json(orient='records'))  # Output predictions as JSON

def main():
    parser = argparse.ArgumentParser(description="Recipe Scraper")
    parser.add_argument('mode', choices=['train', 'predict'], help='Mode: train or predict')
    parser.add_argument('urls', nargs='+', help='List of URLs to process')
    args = parser.parse_args()
    
    scraper = RecipeScraper()
    scraper.process_urls(args.urls, args.mode)

if __name__ == "__main__":
    main()
